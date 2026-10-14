/**
 * Text extraction for uploaded resumes. All local — no paid APIs.
 *   PDF (text layer)  -> pdfjs-dist
 *   DOCX              -> mammoth
 *   DOC (legacy)      -> word-extractor
 *   PNG/JPG/TIFF/BMP  -> sharp preprocessing + tesseract.js OCR (English, bundled traineddata)
 *   Scanned PDF       -> pages rendered with pdfjs + @napi-rs/canvas, then the same OCR
 * OCR output is never fully trustworthy (a wrong phone digit is possible), so
 * callers flag every OCR-derived draft for human verification.
 */
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff']);
const SUPPORTED_EXT = new Set(['.pdf', '.docx', '.doc', ...IMAGE_EXT]);
const MIN_PDF_TEXT_CHARS = 40;
const MAX_PDF_PAGES = 15;
const MAX_OCR_PDF_PAGES = 3;
const OCR_TARGET_WIDTH = 2048; // upscaling to ~2000px wide measurably fixes digit/letter errors on phone photos

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

  try {
    const pages = [];
    try {
      for (let p = 1; p <= Math.min(pdf.numPages, MAX_PDF_PAGES); p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        pages.push(linesFromItems(content.items));
      }
    } catch (err) {
      throw new ExtractError('corrupt_file', `Could not read PDF: ${err.message}`);
    }

    const text = pages.join('\n').trim();
    if (text.length >= MIN_PDF_TEXT_CHARS) return { text, method: 'pdf-text' };

    // No text layer: a scanned PDF. Render the first pages and OCR them.
    return { text: await ocrPdfPages(pdf), method: 'pdf-ocr' };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

/**
 * Rebuild lines from positioned text items in the PDF's own stream order.
 * Stream order keeps multi-column layouts intact (left column, then right
 * column); sorting by y instead would interleave the columns line by line.
 * A new line starts when the baseline moves; items on one baseline are joined,
 * with a space only where there is a visible gap.
 */
function linesFromItems(items) {
  const lines = [];
  let cur = '';
  let curY = null;
  let prevEnd = null;
  const flush = () => { if (cur.trim()) lines.push(cur.replace(/\s+/g, ' ').trim()); cur = ''; prevEnd = null; };

  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = it.height || Math.abs(it.transform[3]) || 10;
    if (curY !== null && Math.abs(y - curY) > Math.max(2, h * 0.5)) flush();
    if (it.str.length) {
      const gap = prevEnd === null ? 0 : x - prevEnd;
      const needsSpace = cur && gap > Math.max(1, h * 0.15) && !/\s$/.test(cur) && !/^\s/.test(it.str);
      cur += (needsSpace ? ' ' : '') + it.str;
      prevEnd = x + (it.width || 0);
      curY = y;
    }
    if (it.hasEOL) { flush(); curY = null; }
  }
  flush();
  return lines.join('\n');
}

async function ocrPdfPages(pdf) {
  let factory;
  try { factory = pdf.canvasFactory; } catch { factory = null; }
  if (!factory) throw new ExtractError('needs_ocr', 'PDF has no readable text layer and could not be rendered for OCR.');
  const out = [];
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, MAX_OCR_PDF_PAGES); p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: OCR_TARGET_WIDTH / base.width });
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: context, viewport }).promise;
      const png = canvas.toBuffer('image/png');
      factory.destroy({ canvas, context });
      out.push((await recognize(png, { preprocess: false })).trim());
    }
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError('ocr_failed', `OCR failed: ${err.message}`);
  }
  return out.filter(Boolean).join('\n');
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

/** Clean up a photo/screenshot for OCR: honour EXIF rotation, greyscale, stretch contrast, upscale. */
async function preprocessForOcr(buffer) {
  const sharp = require('sharp');
  return sharp(buffer)
    .rotate()
    .resize({ width: OCR_TARGET_WIDTH, withoutEnlargement: false })
    .grayscale()
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
}

async function recognize(buffer, { preprocess = true } = {}) {
  const worker = await getOcrWorker();
  const input = preprocess ? await preprocessForOcr(buffer) : buffer;
  const { data } = await worker.recognize(input);
  return data.text || '';
}

/**
 * Second chance for designer resumes with light text on a dark banner, which
 * Tesseract reads as nothing. OCRs the top third of the image inverted. Only
 * called when the normal pass found no name, because it costs another OCR run.
 */
async function extractImageHeaderInverted(buffer) {
  const sharp = require('sharp');
  const meta = await sharp(buffer).rotate().metadata();
  const header = await sharp(buffer)
    .rotate()
    .extract({ left: 0, top: 0, width: meta.width, height: Math.max(50, Math.round(meta.height * 0.33)) })
    .resize({ width: OCR_TARGET_WIDTH, withoutEnlargement: false })
    .grayscale()
    .negate()
    .normalise()
    .png()
    .toBuffer();
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(header);
  return data.text || '';
}

async function extractImage(buffer) {
  try {
    return { text: await recognize(buffer), method: 'ocr' };
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

module.exports = { extractText, extractImageHeaderInverted, terminateOcrWorker, ExtractError, SUPPORTED_EXT, IMAGE_EXT };
