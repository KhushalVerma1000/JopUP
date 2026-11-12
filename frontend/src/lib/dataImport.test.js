import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, screenFiles, fileStatus, totalsOf, unknownStatuses, normHeader, statusOverridesFrom, mappingOverridesFrom, skippedCsv, plural, clientOptsFor, fileClientsFrom, clientNote,
} from './dataImport.js';

const f = (name, size = 1000, lastModified = 1) => ({ name, size, lastModified });

test('screening: accepts spreadsheets, says why it refuses the rest', () => {
  const { accepted, rejected } = screenFiles([f('a.xlsx'), f('b.csv'), f('notes.pdf'), f('old.xls'), f('big.xlsx', MAX_FILE_BYTES + 1)]);
  assert.deepEqual(accepted.map((x) => x.name), ['a.xlsx', 'b.csv']);
  assert.deepEqual(rejected.map((r) => r.name), ['notes.pdf', 'old.xls', 'big.xlsx']);
  assert.match(rejected[1].reason, /xlsx/);
});

test('screening: the same file twice, the file-count cap and the total-size cap', () => {
  assert.equal(screenFiles([f('a.xlsx')], [f('a.xlsx')]).rejected[0].reason, 'Already added');
  assert.equal(screenFiles([f('a.xlsx', 1000, 1)], [f('a.xlsx', 1000, 2)]).accepted.length, 1);
  const eleven = Array.from({ length: MAX_FILES + 1 }, (_, i) => f(`f${i}.csv`, 10, i));
  const r = screenFiles(eleven); assert.equal(r.accepted.length, MAX_FILES); assert.match(r.rejected[0].reason, /10 files/);
  const big = Array.from({ length: 3 }, (_, i) => f(`b${i}.csv`, 9 * 1048576, i));
  const t = screenFiles(big); assert.equal(t.accepted.length, 2); assert.ok(2 * 9 * 1048576 <= MAX_TOTAL_BYTES); assert.match(t.rejected[0].reason, /total/);
});

const sheet = (o = {}) => ({ name: 'S', kind: 'lineup', columns: [], summary: { unknownStatuses: [] }, ...o });
test('file status: ready, check, skipped', () => {
  assert.equal(fileStatus(undefined).state, 'reading');
  assert.equal(fileStatus({ error: 'bad' }).state, 'skipped');
  assert.equal(fileStatus({ duplicateOf: 'a.xlsx' }).state, 'skipped');
  assert.equal(fileStatus({ totals: { rows: 0 }, sheets: [] }).state, 'skipped');
  assert.equal(fileStatus({ totals: { rows: 5 }, sheets: [sheet()] }).state, 'ready');
  const review = sheet({ columns: [{ status: 'review' }] });
  assert.equal(fileStatus({ totals: { rows: 5 }, sheets: [review] }).state, 'check');
  assert.match(fileStatus({ totals: { rows: 5 }, sheets: [review] }).note, /1 thing to check/);
  assert.equal(fileStatus({ totals: { rows: 5 }, sheets: [sheet(), sheet({ kind: 'unknown' })] }).state, 'check');
});

test('totals leave out skipped files; unknown status words merge across files', () => {
  const a = { file: { name: 'a' }, analysis: { totals: { rows: 10, people: 8 }, sheets: [sheet({ summary: { unknownStatuses: [{ key: 'hold for now', text: 'Hold for now', count: 4 }] } })] } };
  const b = { file: { name: 'b' }, analysis: { totals: { rows: 5, people: 5 }, sheets: [sheet({ summary: { unknownStatuses: [{ key: 'hold for now', text: 'Hold for now', count: 2 }] } })] } };
  const dup = { file: { name: 'c' }, analysis: { duplicateOf: 'a' } };
  const bad = { file: { name: 'd' }, analysis: { error: 'x' } };
  assert.deepEqual(totalsOf([a, b, dup, bad]), { files: 2, rows: 15, people: 13 });
  const u = unknownStatuses([a, b, dup]);
  assert.equal(u.length, 1); assert.equal(u[0].count, 6); assert.deepEqual(u[0].files, ['a', 'b']);
});

test('answers become what the API wants', () => {
  assert.equal(normHeader('  Lineup-Date! '), 'lineup date');
  assert.deepEqual(statusOverridesFrom({ x: 'hold', y: '', z: 'joined' }), { x: { stageKey: null, status: 'on_hold' }, z: { stageKey: 'joined', status: 'placed' } });
  assert.deepEqual(mappingOverridesFrom({ a: 'phone', b: '' }), { a: 'phone' });
});

test('left-out rows as CSV: quoted where needed', () => {
  const rows = [{ sheetName: 'a › Oct, 13', rowNumber: 4, data: { candidate: { firstName: 'Rahul', lastName: 'K', phone: '98' }, tracker: { clientName: 'Axis "Bank"' } } }];
  const csv = skippedCsv(rows, () => 'Repeat row');
  assert.equal(csv.split('\r\n')[1], '"a › Oct, 13",4,Rahul K,98,"Axis ""Bank""",Repeat row');
  assert.equal(plural(1, 'row'), '1 row'); assert.equal(plural(2, 'person', 'people'), '2 people');
});

test('client choice: no answer asks for our suggestion; an answer is sent as given', () => {
  assert.deepEqual(clientOptsFor({}, 'a.xlsx'), { clientMode: 'auto' });
  assert.deepEqual(clientOptsFor({ 'a.xlsx': { mode: 'name', name: 'HDFC Delhi' } }, 'a.xlsx'), { clientMode: 'name', clientName: 'HDFC Delhi' });
  assert.deepEqual(clientOptsFor({ 'a.xlsx': { mode: 'sheet' } }, 'a.xlsx'), { clientMode: 'sheet', clientName: undefined });
});

test('client choice: the preview gets what each file resolved to; files with their own Client column get none', () => {
  const entries = [
    { file: { name: 'a.xlsx' }, analysis: { client: { needed: true, mode: 'name', name: 'HDFC Delhi' } } },
    { file: { name: 'b.xlsx' }, analysis: { client: { needed: true, mode: 'sheet', name: null } } },
    { file: { name: 'c.xlsx' }, analysis: { client: { needed: false, mode: 'none' } } },
    { file: { name: 'd.xlsx' }, analysis: { error: 'x' } },
  ];
  assert.deepEqual(fileClientsFrom(entries), { 'a.xlsx': { mode: 'name', name: 'HDFC Delhi' }, 'b.xlsx': { mode: 'sheet', name: undefined }, 'c.xlsx': { mode: 'none' }, 'd.xlsx': { mode: 'none' } });
});

test('client choice: a file with lineups but no client is something to check; the note says what will happen', () => {
  const sheet = { name: 'S', kind: 'lineup', columns: [], summary: { unknownStatuses: [] } };
  const none = { totals: { rows: 5 }, sheets: [sheet], client: { needed: true, mode: 'none' } };
  assert.equal(fileStatus(none).state, 'check');
  assert.equal(fileStatus({ ...none, client: { needed: true, mode: 'name', name: 'Axis' } }).state, 'ready');
  assert.equal(fileStatus({ ...none, client: { needed: false, mode: 'none' } }).state, 'ready');
  assert.equal(clientNote({ needed: true, mode: 'sheet', sheetNames: ['A', 'B', 'C', 'D'] }), 'Each tab is a client: A, B, C and 1 more');
  assert.equal(clientNote({ needed: true, mode: 'name', name: 'Axis' }), 'All lineups go to the client “Axis”');
  assert.match(clientNote({ needed: true, mode: 'none' }), /without a client/);
  assert.equal(clientNote({ needed: false, mode: 'none' }), null);
});
