/**
 * Spreadsheet file -> plain grids. No interpretation happens here.
 * xlsx / xlsm via exceljs, csv / tsv / txt via csv-parse. Legacy .xls is
 * refused with a clear message (re-save as .xlsx) rather than parsed badly.
 */
const path = require('path');
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');
const { BadRequestError } = require('../../utils/errors');

const MAX_SHEETS = 30;
const MAX_ROWS = 10000;
const MAX_COLS = 60;

function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);           // formula
    if ('text' in v) return cellValue(v.text);               // hyperlink
    if ('error' in v) return null;                           // #N/A etc.
    return null;
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new BadRequestError('This file could not be opened. Save it as .xlsx (Excel Workbook) and try again.'); }
  const sheets = []; let truncated = false;
  wb.eachSheet((ws) => {
    if (sheets.length >= MAX_SHEETS) { truncated = true; return; }
    if (ws.state && ws.state !== 'visible') return; // hidden tabs are usually scratch work
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      if (n > MAX_ROWS + 25) { truncated = true; return; }
      const cells = [];
      for (let c = 1; c <= Math.min(ws.columnCount, MAX_COLS); c += 1) cells.push(cellValue(row.getCell(c).value));
      rows[n - 1] = cells;
    });
    for (let i = 0; i < rows.length; i += 1) if (!rows[i]) rows[i] = [];
    sheets.push({ name: ws.name, rows });
  });
  return { sheets, truncated };
}

function readCsv(buffer) {
  let text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const count = (ch) => (head.match(new RegExp(ch === '\t' ? '\\t' : `\\${ch}`, 'g')) || []).length;
  const delimiter = [',', ';', '\t', '|'].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
  let rows;
  try { rows = parse(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: false }); }
  catch { throw new BadRequestError('This CSV could not be read. Open it in Excel and save it as .xlsx.'); }
  const truncated = rows.length > MAX_ROWS + 25;
  return { sheets: [{ name: 'Sheet1', rows: rows.slice(0, MAX_ROWS + 25).map((r) => r.slice(0, MAX_COLS).map((v) => (v === '' ? null : v))) }], truncated };
}

async function readWorkbook(buffer, fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.xls') throw new BadRequestError('Old .xls files are not supported. Open it in Excel and save as .xlsx, then upload again.');
  if (['.xlsx', '.xlsm'].includes(ext)) return readXlsx(buffer);
  if (['.csv', '.tsv', '.txt'].includes(ext)) return readCsv(buffer);
  throw new BadRequestError('Upload an Excel (.xlsx) or CSV file.');
}

module.exports = { readWorkbook, MAX_ROWS, MAX_SHEETS };
