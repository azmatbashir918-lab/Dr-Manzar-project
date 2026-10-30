import multer from 'multer';
import bundledFfmpeg from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, stat, rename, unlink, rm } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';

export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_MAX_SECONDS = 3600;
export const audioPath = /^\/api\/v1\/media\/narration\/[a-f0-9-]{36}\.mp3$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
const formats = {
  'audio/mpeg': { extension: '.mp3', demuxer: 'mp3' },
  'audio/wav': { extension: '.wav', demuxer: 'wav' },
  'audio/x-wav': { extension: '.wav', demuxer: 'wav' },
  'audio/mp4': { extension: '.m4a', demuxer: 'mov' },
  'audio/x-m4a': { extension: '.m4a', demuxer: 'mov' },
};

function matchesHeader(buffer, demuxer) {
  if (demuxer === 'wav') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  if (demuxer === 'mov') return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
  return buffer.length >= 3 && (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 255 && (buffer[1] & 0xe0) === 0xe0));
}

// Spawn without a shell. Force the selected container, disallow network protocols,
// decode actual samples, remove metadata/extra streams and encode a fresh MP3.
export function transcodeAudio({ executable, input, output, demuxer, maxSeconds = AUDIO_MAX_SECONDS, timeoutMs = 120000, signal }) {
  return new Promise((resolveResult, reject) => {
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-err_detect', 'explode',
      '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-f', demuxer,
      ...(demuxer === 'mov' ? ['-enable_drefs', '0'] : []), '-i', input,
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', String(maxSeconds + 1), '-map_metadata', '-1', '-map_chapters', '-1',
      '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', '-id3v2_version', '0', '-write_id3v1', '0',
      '-f', 'mp3', '-progress', 'pipe:1', output];
    let child;
    try { child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal }); }
    catch { return reject(fail(503, 'Audio processor is unavailable')); }
    let progress = '', diagnostic = '', timedOut = false, spawnError = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', chunk => { progress = (progress + chunk.toString()).slice(-64000); });
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4000); });
    child.once('error', () => { spawnError = true; });
    child.once('close', code => {
      clearTimeout(timer);
      if (signal?.aborted) return reject(fail(400, 'Upload cancelled'));
      if (spawnError) return reject(fail(503, 'Audio processor is unavailable'));
      if (timedOut) return reject(fail(422, 'Recording took too long to process'));
      if (code !== 0 || diagnostic.trim()) return reject(fail(422, 'Recording could not be decoded completely'));
      const times = [...progress.matchAll(/^out_time_us=(\d+)$/gm)].map(m => Number(m[1]) / 1e6);
      const duration = times.length ? Math.max(...times) : 0;
      if (duration < 0.25 || duration > maxSeconds) return reject(fail(422, `Narration must be between 0.25 seconds and ${maxSeconds} seconds`));
      resolveResult({ durationSeconds: Math.round(duration * 1000) / 1000 });
    });
  });
}

export function createAudioHandlers({ db, config, audit }) {
  const root = resolve(config.audioDirectory || 'data/narration');
  const workRoot = resolve(config.audioWorkDirectory || 'data/narration-work');
  const executable = config.ffmpegPath || bundledFfmpeg;
  const parse = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: AUDIO_MAX_BYTES, files: 1, fields: 0, parts: 2, fieldNameSize: 40 },
    fileFilter(req, file, done) {
      const format = formats[file.mimetype];
      if (!format || extname(file.originalname).toLowerCase() !== format.extension) return done(fail(415, 'Use an MP3, WAV or M4A file with matching extension and audio content type'));
      done(null, true);
    },
  }).single('audio');
  let active = 0;
  function capacity(req, res, next) {
    if (!['en', 'ur'].includes(req.params.language)) return next(fail(400, 'Narration language must be en or ur'));
    if (!executable) return next(fail(503, 'Audio processor is unavailable'));
    if (active >= 2) return next(fail(429, 'Audio processing is busy. Try again shortly.'));
    active++;
    let released = false;
    req.releaseAudioSlot = () => { if (!released) { active--; released = true; } };
    const controller = new AbortController(); req.audioSignal = controller.signal;
    res.once('finish', req.releaseAudioSlot);
    res.once('close', () => {
      controller.abort();
      if (!req.processingAudio) req.releaseAudioSlot();
    });
    next();
  }
  function multipart(req, res, next) {
    if (!req.is('multipart/form-data')) return next(fail(415, 'Use multipart/form-data with one file named audio'));
    parse(req, res, error => {
      if (error instanceof multer.MulterError) return next(fail(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
        error.code === 'LIMIT_FILE_SIZE' ? 'Narration exceeds the 50 MiB limit' : 'Upload exactly one audio file and no extra fields'));
      next(error);
    });
  }
  async function upload(req, res) {
    if (!req.file?.buffer.length) throw fail(400, 'A non-empty audio file is required');
    const format = formats[req.file.mimetype];
    if (!matchesHeader(req.file.buffer, format.demuxer)) throw fail(422, 'Recording does not match its declared audio format');
    req.processingAudio = true;
    let work, destination, persisted = false;
    try {
      await mkdir(workRoot, { recursive: true });
      work = await mkdtemp(resolve(workRoot, 'job-'));
      const input = resolve(work, 'source' + format.extension), output = resolve(work, 'narration.mp3');
      await writeFile(input, req.file.buffer, { flag: 'wx', mode: 0o600 });
      // Release large JS buffers before decoding; concurrency is bounded above.
      req.file.buffer = null;
      const info = await transcodeAudio({ executable, input, output, demuxer: format.demuxer, signal: req.audioSignal });
      if (req.audioSignal.aborted) throw fail(400, 'Upload cancelled');
      const details = await stat(output);
      if (!details.size || details.size > AUDIO_MAX_BYTES) throw fail(422, 'Processed narration exceeds the allowed size');
      const id = randomUUID(), filename = `${id}.mp3`;
      await mkdir(root, { recursive: true });
      destination = resolve(root, filename);
      // Both configured locations must be on the same volume for atomic rename.
      await rename(output, destination);
      await config.mediaStorage?.put('narration',filename,destination);
      await transaction(db, async () => {
        await db.insert('narration_uploads',{id,filename,language:req.params.language,duration_seconds:info.durationSeconds,bytes:details.size,uploaded_by:req.user.id,created_at:Date.now()});
        await audit(req.user.id, 'narration.upload.' + req.params.language, id);
      });
      persisted = true;
      res.status(201).json({ audio: { id, language: req.params.language, url: `/api/v1/media/narration/${filename}`,
        mimeType: 'audio/mpeg', durationSeconds: info.durationSeconds, bytes: details.size } });
    } finally {
      if (destination && !persisted) {
        await unlink(destination).catch(() => {});
        await config.mediaStorage?.remove('narration',destination.split(/[\\/]/).at(-1)).catch(() => {});
      }
      if (work) {
        const delta = relative(workRoot, resolve(work));
        if (delta && !delta.startsWith('..') && !isAbsolute(delta) && delta.startsWith('job-')) await rm(work, { recursive: true, force: true });
      }
      req.processingAudio = false;
      req.releaseAudioSlot();
    }
  }
  async function serve(req, res, next) {
    if (!/^[a-f0-9-]{36}\.mp3$/.test(req.params.filename)) return next(fail(404, 'Narration not found'));
    const row = await db.one('narration_uploads',{filename:req.params.filename});
    if (!row) return next(fail(404, 'Narration not found'));
    await config.mediaStorage?.ensure('narration',row.filename,resolve(root,row.filename));
    res.set({ 'Content-Type': 'audio/mpeg', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.sendFile(resolve(root, row.filename), { dotfiles: 'deny', acceptRanges: true }, error => {
      if (error) { if (!res.headersSent) res.removeHeader('Cache-Control'); next(error); }
    });
  }
  return { capacity, multipart, upload, serve };
}
