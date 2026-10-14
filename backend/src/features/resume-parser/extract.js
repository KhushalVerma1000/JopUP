/**
 * Text extraction for uploaded resumes. All local — no paid APIs.
 *   PDF (text layer)  -> pdfjs-dist
 *   DOCX              -> mammoth
 *   DOC (legacy)      -> word-extractor
 *   PNG/JPG/TIFF/BMP  -> tesseract.js OCR (English, bundled traineddata)
 * Scanned PDFs (no text layer) are reported as needs_ocr; rasterising PDF pages
 * for OCR is a deliberate phase-2 item.
 */
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff']);
const SUPPORTED_EXT = new Set(['.pdf', '.docx', '.doc', ...IMAGE_EXT]);
const MIN_PDF_TEXT_CHARS = 40;
const MAX_PDF_PAGES = 15;

class ExtractError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let workerPromise = null;
function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
      return createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
    })().catch((err) => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

async function terminateOcrWorker() {
  if (!workerPromise) return;
  const p = workerPromise;
  workerPromise = null;
  try { (await p).terminate(); } catch { /* already gone */ }
}

async function extractPdf(buffer) {
  let pdf;
  try {
    // pdfjs-dist is ESM-only, hence the dynamic import from this CommonJS file.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    throw new ExtractError('corrupt_file', `Could not read PDF: ${err.message}`);
  }

  const pages = [];
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, MAX_PDF_PAGES); p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push(linesFromItems(content.items));
    }
  } catch (err) {
    throw new ExtractError('corrupt_file', `Could not read PDF: ${err.message}`);
  } finally {
    await pdf.destroy().catch(() => {});
  }

  const text = pages.join('\n').trim();
  if (text.length < MIN_PDF_TEXT_CHARS) {
    throw new ExtractError('needs_ocr', 'PDF has no readable text layer (scanned?). Upload as an image or a text-based PDF.');
  }
  return { text, method: 'pdf-text' };
}

/** Rebuild reading-order lines from positioned text items (y desc, x asc). */
function linesFromItems(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const tol = Math.max(2, (it.height || 10) * 0.4);
    let row = rows.find(r => Math.abs(r.y - y) <= tol);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, str: it.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim())
    .join('\n');
}

async function extractDocx(buffer) {
  const mammoth = require('mammoth');
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value || '', method: 'docx' };
  } catch (err) {
    throw new ExtractError('corrupt_file', `Could not read DOCX: ${err.message}`);
  }
}

async function extractDoc(buffer) {
  const WordExtractor = require('word-extractor');
  try {
    const doc = await new WordExtractor().extract(buffer);
    return { text: [doc.getBody(), doc.getHeaders && doc.getHeaders(), doc.getFooters && doc.getFooters()].filter(Boolean).join('\n'), method: 'doc' };
  } catch (err) {
    throw new ExtractError('corrupt_file', `Could not read DOC: ${err.message}`);
  }
}

async function extractImage(buffer) {
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(buffer);
    return { text: data.text || '', method: 'ocr' };
  } catch (err) {
    throw new ExtractError('ocr_failed', `OCR failed: ${err.message}`);
  }
}

/**
 * @param {Buffer} buffer
 * @param {string} fileName original filename (extension decides the extractor)
 * @returns {Promise<{text: string, method: string}>}
 */
async function extractText(buffer, fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) {
    throw new ExtractError('unsupported_type', `Unsupported file type "${ext || 'unknown'}". Use PDF, DOCX, DOC, PNG or JPG.`);
  }
  let result;
  if (ext === '.pdf') result = await extractPdf(buffer);
  else if (ext === '.docx') result = await extractDocx(buffer);
  else if (ext === '.doc') result = await extractDoc(buffer);
  else result = await extractImage(buffer);

  if (!result.text || result.text.trim().length < 10) {
    throw new ExtractError('empty_text', 'No readable text found in this file.');
  }
  return result;
}

module.exports = { extractText, terminateOcrWorker, ExtractError, SUPPORTED_EXT };
