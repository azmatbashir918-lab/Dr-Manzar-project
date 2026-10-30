import { parentPort, workerData } from 'node:worker_threads';
import { PDFDocument, PDFDict, PDFArray, PDFName, PDFRawStream } from 'pdf-lib';

try {
  const bytes = new Uint8Array(workerData);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  const pageCount = doc.getPageCount();
  if (doc.isEncrypted || pageCount < 1 || pageCount > 2000) throw new Error('Unsupported page count or encryption');
  const forbidden = new Set(['JS', 'JavaScript', 'OpenAction', 'AA', 'Launch', 'EmbeddedFiles', 'EmbeddedFile', 'RichMedia', 'XFA', 'AF', 'AcroForm', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData', 'Rendition', 'Movie', 'Sound']);
  const visited = new Set(), pending = doc.context.enumerateIndirectObjects().map(([, value]) => value);
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item || visited.has(item)) continue;
    visited.add(item);
    if (++count > 200000) throw new Error('Document is too complex');
    if (item instanceof PDFName && forbidden.has(item.decodeText())) throw new Error('Active PDF content is not accepted');
    if (item instanceof PDFRawStream) pending.push(item.dict);
    if (item instanceof PDFDict) for (const [name, value] of item.entries()) pending.push(name, value);
    if (item instanceof PDFArray) pending.push(...item.asArray());
  }
  parentPort.postMessage({ pageCount });
} catch {
  parentPort.postMessage({ error: 'PDF must be readable, unencrypted, 1-2000 pages, without scripts, forms, embedded files or launch actions' });
}
