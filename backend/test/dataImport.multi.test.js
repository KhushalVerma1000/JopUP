const test = require('node:test');
const assert = require('node:assert/strict');
const { analyseSheet } = require('../src/features/data-import/analyse');
const { buildPlan } = require('../src/features/data-import/match');
const C = require('../src/features/data-import/combine');

const NOW = new Date(Date.UTC(2026, 9, 14));
const opts = { defaultCountry: 'IN', now: NOW };
const STAGES = ['applied', 'screening', 'lineup', 'turnup', 'interview', 'offer', 'joined'].map((k, i) => ({ stageKey: k, name: k, orderIndex: (i + 1) * 10 }));
const HEAD = ['Name', 'Phone', 'Client', 'Position', 'Job Location', 'Lineup Date', 'Status'];
const catalog = () => ({ clients: [], locations: [], positions: [], users: [{ id: 'u-me', firstName: 'Imp', lastName: 'Orter', email: 'i@acme.in' }],
  candidates: [], liveTags: [], stages: STAGES, permissions: {} });

// ── helpers ───────────────────────────────────────────────────────────────
test('labels: short, unique and free of the characters used in row keys', () => {
  assert.deepEqual(C.labelFiles(['lineups_oct.xlsx', 'lineups_sep.xlsx']), ['lineups_oct', 'lineups_sep']);
  assert.deepEqual(C.labelFiles(['a.xlsx', 'a.csv', 'a.xlsx']), ['a', 'a (2)', 'a (3)']);
  assert.equal(C.labelFiles(['10:30 list.xlsx'])[0], '10-30 list');
  assert.ok(C.labelFiles(['.xlsx'])[0].length > 0);
});

test('sheets are qualified with their file, and nothing else about them changes', () => {
  const [s] = C.qualifySheets([{ name: 'Oct 13', records: [1, 2], kind: 'lineup' }], 'lineups_oct');
  assert.equal(s.name, 'lineups_oct › Oct 13');
  assert.deepEqual(s.records, [1, 2]); assert.equal(s.kind, 'lineup');
});

test('batch name: one or two files by name, more files counted', () => {
  assert.equal(C.batchFileName(['a.xlsx']), 'a.xlsx');
  assert.equal(C.batchFileName(['a.xlsx', 'b.csv']), 'a.xlsx, b.csv');
  assert.equal(C.batchFileName(['a.xlsx', 'b.csv', 'c.csv', 'd.csv']), 'a.xlsx + 3 more');
});

test('hash: a single file keeps its own hash; several do not depend on order', () => {
  const a = C.sha256(Buffer.from('one')); const b = C.sha256(Buffer.from('two'));
  assert.equal(C.combinedHash([a]), a);
  assert.equal(C.combinedHash([a, b]), C.combinedHash([b, a]));
  assert.notEqual(C.combinedHash([a, b]), a);
  assert.equal(a.length, 64);
});

test('limits are what the screen promises', () => {
  assert.equal(C.MAX_FILES, 10); assert.equal(C.MAX_TOTAL_BYTES, 25 * 1024 * 1024);
});

// ── the plan across files ─────────────────────────────────────────────────
const fileA = analyseSheet({ name: 'Oct 13', rows: [HEAD,
  ['Rahul Sharma', 9876543210, 'Tata Trent', 'Sales Executive', 'Pune', '13/10/2026', 'Lined up'],
  ['Amit Singh', 9123456789, 'Tata Trent', 'Sales Executive', 'Pune', '13/10/2026', 'Lined up']] }, opts);
const fileB = analyseSheet({ name: 'Oct 13', rows: [HEAD,
  ['Rahul Sharma', '98765 43210', 'Tata Trent', 'Store Manager', 'Mumbai', '20/10/2026', 'Lined up'],
  ['Neha Roy', 9000011111, 'Orbit Logistics', 'Analyst', 'Delhi', '20/10/2026', 'Lined up']] }, opts);
const merged = () => [...C.qualifySheets([fileA], 'sep'), ...C.qualifySheets([fileB], 'oct')];
const run = (decisions = {}) => buildPlan({ sheets: merged(), catalog: catalog(), decisions, opts: { now: NOW } });

test('two files with a same-named tab stay apart, and rows say which file they came from', () => {
  const built = run();
  const names = [...new Set(built.rows.map((r) => r.sheetName))];
  assert.deepEqual(names, ['sep › Oct 13', 'oct › Oct 13']);
  assert.equal(built.rows.length, 4);
  assert.deepEqual(built.rows.map((r) => r.seq), [1, 2, 3, 4]);
});

test('a person in two files is one candidate with a tracker per position', () => {
  const built = run();
  const rahul = built.rows.filter((r) => r.data.candidate.firstName === 'Rahul');
  assert.equal(rahul.length, 2);
  assert.equal(rahul[0].plan.candidateKey, rahul[1].plan.candidateKey);
  assert.equal(built.summary.candidates.unique, 3);  // Rahul, Amit, Neha
  assert.equal(built.summary.clients.new, 2);        // Tata Trent, Orbit Logistics (Tata is in both files)
});

test('skipping a row in one file leaves the same row number in the other file alone', () => {
  const built = run({ rows: { 'sep › Oct 13:2': { action: 'skip' } } });
  const skipped = built.rows.filter((r) => r.plan.action === 'skip');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].sheetName, 'sep › Oct 13');
});

test('one file alone is planned exactly as before: plain sheet names', () => {
  const built = buildPlan({ sheets: [fileA], catalog: catalog(), decisions: {}, opts: { now: NOW } });
  assert.deepEqual([...new Set(built.rows.map((r) => r.sheetName))], ['Oct 13']);
});
