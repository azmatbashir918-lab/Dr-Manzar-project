import { GridFSBucket } from 'mongodb';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

// MongoDB owns durable bytes; the filesystem is only a disposable decode/cache area.
export function createMediaStorage(database) {
  const bucket = new GridFSBucket(database, { bucketName: 'media' });
  const pending = new Map();
  const key = (kind, filename) => {
    if (!['covers','narration','books'].includes(kind) || !/^[a-f0-9-]{36}\.(webp|mp3|pdf)$/.test(filename)) throw new Error('Invalid media key');
    return `${kind}/${filename}`;
  };
  return {
    async put(kind, filename, path) {
      const upload = bucket.openUploadStream(key(kind, filename));
      try { await pipeline(createReadStream(path), upload); }
      catch (error) { await bucket.delete(upload.id).catch(() => {}); throw error; }
    },
    async remove(kind, filename) {
      for await (const file of bucket.find({ filename: key(kind, filename) })) await bucket.delete(file._id);
    },
    async ensure(kind, filename, path) {
      const name = key(kind, filename);
      try { await access(path); return; } catch {}
      if (pending.has(name)) return pending.get(name);
      const task = (async () => {
        const file = await bucket.find({ filename: name }).sort({ uploadDate: -1 }).limit(1).next();
        if (!file) throw Object.assign(new Error('Stored media is unavailable'), { status: 503 });
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomUUID()}.part`;
        try {
          await pipeline(bucket.openDownloadStream(file._id), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
          if ((await stat(temporary)).size !== file.length) throw new Error('Incomplete media download');
          await rename(temporary, path);
        } finally { await unlink(temporary).catch(() => {}); }
      })();
      pending.set(name, task);
      try { await task; } finally { pending.delete(name); }
    },
  };
}
