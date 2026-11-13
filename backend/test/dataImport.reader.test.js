// Reading a tracker must stay fast. ExcelJS's ws.columnCount rescans the whole sheet each time it is read; the reader
// once asked for it per cell, so a 77 KB, 1,000-row file took ~15 s locally and timed out on a small hosted server.
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { readWorkbook } = require('../src/features/data-import/reader');

const build = async (rows, cols, { padTo = 0 } = {}) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Lineups');
  ws.addRow(Array.from({ length: cols }, (_, c) => (c === 0 ? 'Name' : c === 1 ? 'Phone' : `Col ${c}`)));
  for (let r = 0; r < rows; r += 1) ws.addRow(Array.from({ length: cols }, (_, c) => (c === 0 ? `Person ${r}` : c === 1 ? 9800000000 + r : `v${r}-${c}`)));
  if (padTo) ws.getRow(padTo).getCell(1).style = { font: { bold: true } }; // a formatted-but-empty row far down: rowCount grows, no data
  return Buffer.from(await wb.xlsx.writeBuffer());
};

test('a 3,000-row, 25-column tab is read in seconds, with every cell', async () => {
  const buf = await build(3000, 25);
  const t0 = Date.now();
  const { sheets } = await readWorkbook(buf, 'big.xlsx');
  const ms = Date.now() - t0;
  assert.equal(sheets[0].rows.length, 3001);
  assert.equal(sheets[0].rows[3000][0], 'Person 2999'); assert.equal(sheets[0].rows[3000][24], 'v2999-24');
  assert.ok(ms < 8000, `took ${ms} ms (it was minutes before the fix)`);
});

test('formatted-but-empty rows below the data do not slow the read or add candidates', async () => {
  const buf = await build(50, 30, { padTo: 1000 });
  const t0 = Date.now();
  const { sheets } = await readWorkbook(buf, 'padded.xlsx');
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(sheets[0].rows.filter((r) => r.some((v) => v !== null)).length, 51);
});
