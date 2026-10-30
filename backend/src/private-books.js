import multer from 'multer';
import { Worker } from 'node:worker_threads';
import { randomUUID, createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { transaction } from './db.js';

export const BOOK_MAX_BYTES = 50 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
export function validatePdf(buffer) {
  if (!/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(buffer.toString('ascii', 0, 8)) || !buffer.subarray(-1024).includes(Buffer.from('%%EOF'))) {
    return Promise.reject(fail(422, 'File is not a complete PDF'));
  }
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(new URL('./pdf-validation-worker.js', import.meta.url), {
      workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(() => { worker.terminate(); reject(fail(422, 'PDF validation exceeded its processing limit')); }, 15000);
    worker.once('message', result => {
      clearTimeout(timer); worker.terminate();
      result.error ? reject(fail(422, result.error)) : resolveResult(result);
    });
    worker.once('error', () => { clearTimeout(timer); reject(fail(422, 'PDF could not be validated')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(fail(422, 'PDF validation stopped')); });
  });
}
export function createPrivateBookHandlers({ db, directory, audit, storage }) {
  const root = resolve(directory || 'data/private-books');
  const metadata = row => ({ id: row.id, bookId: row.book_id, language: row.language, mimeType: 'application/pdf',
    bytes: row.bytes, pageCount: row.page_count, sha256: row.sha256, createdAt: row.created_at });
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: BOOK_MAX_BYTES, files: 1, fields: 0, parts: 2 },
    fileFilter(req, file, next) {
      if (file.mimetype !== 'application/pdf' || extname(file.originalname).toLowerCase() !== '.pdf') return next(fail(415, 'Upload a PDF with matching filename and application/pdf content type'));
      next(null, true);
    },
  }).single('document');
  let active = 0;
  async function admission(req, res, next) {
    if (!['en', 'ur'].includes(req.params.language)) return next(fail(400, 'Book language must be en or ur'));
    const book = await db.one('content',{id:req.params.bookId,kind:'books'});
    if (!book) return next(fail(404, 'Book not found'));
    if (active >= 2) return next(fail(429, 'Book validation is busy. Try again shortly.'));
    active++;
    let released = false;
    req.releaseBookSlot = () => { if (!released) { active--; released = true; } };
    res.once('finish', req.releaseBookSlot);
    res.once('close', () => { if (!req.validatingBook) req.releaseBookSlot(); });
    next();
  }
  function multipart(req, res, next) {
    if (!req.is('multipart/form-data')) return next(fail(415, 'Use multipart/form-data with one document file'));
    parse(req, res, error => {
      if (error instanceof multer.MulterError) return next(fail(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
        error.code === 'LIMIT_FILE_SIZE' ? 'Book exceeds the 50 MiB limit' : 'Upload one document and no additional fields'));
      next(error);
    });
  }
  async function upload(req, res) {
    if (!req.file?.buffer.length) throw fail(400, 'A non-empty PDF is required');
    req.validatingBook = true;
    let path, stored = false;
    try {
      const { pageCount } = await validatePdf(req.file.buffer);
      if (res.destroyed) throw fail(400, 'Upload cancelled');
      const id = randomUUID(), filename = `${id}.pdf`, bytes = req.file.buffer.length;
      const sha256 = createHash('sha256').update(req.file.buffer).digest('hex');
      await mkdir(root, { recursive: true }); path = resolve(root, filename);
      await writeFile(path, req.file.buffer, { flag: 'wx', mode: 0o600 });
      await storage?.put('books',filename,path);
      await transaction(db, async () => {
        await db.insert('private_book_files',{id,book_id:req.params.bookId,language:req.params.language,filename,bytes,page_count:pageCount,sha256,uploaded_by:req.user.id,created_at:Date.now()});
        await audit(req.user.id, 'book.file.upload', id);
      });
      stored = true;
      res.status(201).json({ file: metadata(await db.one('private_book_files',{id})) });
    } finally {
      if (path && !stored) {
        await unlink(path).catch(() => {});
        await storage?.remove('books',path.split(/[\\/]/).at(-1)).catch(() => {});
      }
      req.validatingBook = false; req.releaseBookSlot();
    }
  }
  async function list(req, res) {
    if (!await db.one('content',{id:req.params.bookId,kind:'books'})) throw fail(404, 'Book not found');
    res.json({ items: (await db.many('private_book_files',{book_id:req.params.bookId},{sort:{created_at:-1},limit:100})).map(metadata) });
  }
  async function download(req, res, next) {
    const row = await db.one('private_book_files',{id:req.params.fileId,book_id:req.params.bookId});
    if (!row) return next(fail(404, 'Book file not found'));
    await storage?.ensure('books',row.filename,resolve(root,row.filename));
    await audit(req.user.id, 'book.file.staff_download', row.id);
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="book-${row.language}.pdf"` });
    res.sendFile(resolve(root, row.filename), { cacheControl: false, dotfiles: 'deny' }, error => { if (error) next(error); });
  }
  async function validateReferences(kind, id, data) {
    const entries = Object.entries(data.digitalFileIds || {});
    if (entries.length && kind !== 'books') throw fail(400, 'Private book editions can only be attached to books');
    for (const [language, fileId] of entries) {
      const row = await db.one('private_book_files',{id:fileId,book_id:id,language});
      if(row)await storage?.ensure('books',row.filename,resolve(root,row.filename));
      if (!row || !existsSync(resolve(root, row.filename))) throw fail(400, 'Private book file must exist and belong to this book and language');
    }
  }
  return { admission, multipart, upload, list, download, validateReferences };
}
