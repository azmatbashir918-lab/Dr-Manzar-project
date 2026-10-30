import multer from 'multer';
import sharp from 'sharp';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';

export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_MAX_PIXELS = 24_000_000;
export const coverPath = /^\/api\/v1\/media\/covers\/[a-f0-9-]{36}\.webp$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
const allowed = {
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], format: 'jpeg' },
  'image/png': { extensions: ['.png'], format: 'png' },
  'image/webp': { extensions: ['.webp'], format: 'webp' },
};

export function createCoverHandlers({ db, directory, audit, storage }) {
  const root = resolve(directory || 'data/covers');
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: COVER_MAX_BYTES, files: 1, fields: 0, parts: 2, fieldNameSize: 40 },
    fileFilter(req, file, done) {
      const type = allowed[file.mimetype];
      if (!type || !type.extensions.includes(extname(file.originalname).toLowerCase())) {
        return done(fail(415, 'Cover must be a JPEG, PNG or WebP with matching filename and content type'));
      }
      done(null, true);
    },
  }).single('cover');
  // Bound both in-memory multipart buffering and image decoder work per process.
  let active = 0;
  function capacity(req, res, next) {
    if (active >= 2) return next(fail(429, 'Cover processing is busy. Try again shortly.'));
    active++;
    let released = false;
    const release = () => { if (!released) { active--; released = true; } };
    res.once('finish', release); res.once('close', release);
    next();
  }
  function multipart(req, res, next) {
    if (!req.is('multipart/form-data')) return next(fail(415, 'Use multipart/form-data with one file named cover'));
    parse(req, res, error => {
      if (error instanceof multer.MulterError) return next(fail(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
        error.code === 'LIMIT_FILE_SIZE' ? 'Cover exceeds the 5 MiB limit' : 'Upload exactly one cover file and no extra fields'));
      next(error);
    });
  }
  async function upload(req, res) {
    if (!req.file?.buffer.length) throw fail(400, 'A non-empty cover file is required');
    let output;
    try {
      const image = sharp(req.file.buffer, { limitInputPixels: COVER_MAX_PIXELS, failOn: 'warning', animated: true });
      const meta = await image.metadata();
      if (meta.format !== allowed[req.file.mimetype].format || (meta.pages || 1) !== 1 || !meta.width || !meta.height) {
        throw new Error('Image format does not match or is animated');
      }
      // Decode and write a fresh static raster. Original bytes/metadata are never served.
      output = await image.rotate().resize({ width: 1600, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    } catch {
      throw fail(422, 'Invalid cover: provide a non-animated JPEG, PNG or WebP up to 24 megapixels');
    }
    const id = randomUUID(), filename = `${id}.webp`, path = resolve(root, filename);
    await mkdir(root, { recursive: true });
    await writeFile(path, output.data, { flag: 'wx', mode: 0o600 });
    try {
      await storage?.put('covers', filename, path);
      await transaction(db, async () => {
        await db.insert('cover_uploads',{id,filename,width:output.info.width,height:output.info.height,bytes:output.info.size,uploaded_by:req.user.id,created_at:Date.now()});
        await audit(req.user.id, 'cover.upload', id);
      });
    } catch (error) { await unlink(path).catch(() => {}); await storage?.remove('covers',filename).catch(() => {}); throw error; }
    res.status(201).json({ cover: { id, url: `/api/v1/media/covers/${filename}`, mimeType: 'image/webp',
      width: output.info.width, height: output.info.height, bytes: output.info.size } });
  }
  async function serve(req, res, next) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(req.params.filename)) return next(fail(404, 'Cover not found'));
    const row = await db.one('cover_uploads',{filename:req.params.filename});
    if (!row) return next(fail(404, 'Cover not found'));
    await storage?.ensure('covers',row.filename,resolve(root,row.filename));
    res.set({ 'Content-Type': 'image/webp', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.sendFile(resolve(root, row.filename), { dotfiles: 'deny' }, error => {
      if (error) { if (!res.headersSent) res.removeHeader('Cache-Control'); next(error); }
    });
  }
  return { capacity, multipart, upload, serve };
}
