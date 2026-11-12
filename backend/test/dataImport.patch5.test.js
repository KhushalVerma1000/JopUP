// Patch data-import-5: found by importing real staffing trackers. Every case here is a shape those files had,
// rebuilt with invented names and numbers.
const test = require('node:test');
const assert = require('node:assert/strict');

const N = require('../src/features/data-import/normalize');
const { contentFit, matchHeader } = require('../src/features/data-import/headers');
const { analyseSheet, analyseWorkbook } = require('../src/features/data-import/analyse');
const { nameFromFile, suggestClient, resolveClient, isGenericSheetName } = require('../src/features/data-import/clientHint');
const { buildPlan } = require('../src/features/data-import/match');
const { trackerNotes } = require('../src/features/data-import/commit.service');

const NOW = new Date(Date.UTC(2026, 10, 5));
const opts = { defaultCountry: 'IN', now: NOW };
const d = (y, m, day) => new Date(Date.UTC(y, m - 1, day));
const at = (h, m = 0) => new Date(Date.UTC(1899, 11, 30, h, m)); // how Excel hands over a time-only cell

// ── normalisers ─────────────────────────────────────────────────────────────
test('times: Excel time-only cells, day fractions and written times', () => {
  assert.equal(N.parseTime(at(11)), '11:00');
  assert.equal(N.parseTime(at(14, 30)), '14:30');
  assert.equal(N.parseTime(0.5), '12:00');
  assert.equal(N.parseTime('11:30 AM'), '11:30');
  assert.equal(N.parseTime('2 pm'), '14:00');
  assert.equal(N.parseTime('11.15'), '11:15');
  assert.equal(N.parseTime('walk-in'), null);
  assert.equal(N.parseTime(d(2026, 10, 12)), null);
  assert.equal(N.text(at(10)), '10:00'); // no more "1899-12-30"
  assert.equal(N.looksLikeDate(at(10)), false);
});

test('phones: a date, a time or a sentence is never a phone number', () => {
  assert.equal(N.phoneLike(at(11)), false);
  assert.equal(N.phoneLike(d(2026, 10, 30)), false);
  assert.equal(N.phoneLike('Sat Dec 30 1899 11:00:00 GMT'), false);
  assert.equal(N.phoneLike('Fresher'), false);
  assert.equal(N.phoneLike(9811259809), true);
  assert.equal(N.phoneLike('98112 59809 / 63986 87614'), true);
  assert.equal(N.phoneLike('98112 59809 or 63986 87614'), true);
  assert.equal(contentFit('phone', [at(11), at(11), at(10)], { defaultCountry: 'IN' }), 0);
});

test('salaries: what looks like a figure and what does not', () => {
  for (const v of ['26K', '3.5 LPA', '2.16LPA', '22.5 K', 24600, 'Rs 25,000']) assert.equal(N.salaryLike(v), true, String(v));
  for (const v of ['Reached', 'No show', 'Salary 4 Lac', '-', at(11)]) assert.equal(N.salaryLike(v), false, String(v));
});

test('dates: a year far from today is flagged; only written-out dates can be ambiguous', () => {
  assert.equal(N.plausibleDate('2025-03-21', NOW), true);
  assert.equal(N.plausibleDate('2002-07-10', NOW), false);
  assert.equal(N.plausibleDate('2031-01-01', NOW), false);
  assert.equal(N.countAmbiguousDates(['05/10/2026', '13/10/2026', d(2026, 10, 5), '07/07/2026']), 1);
});

test('headers: interview time, sourcing date and a bare "Number"', () => {
  assert.equal(matchHeader('Interview Time').field, 'interviewTime');
  assert.equal(matchHeader('Sourcing Date').field, 'sourcingDate');
  assert.equal(matchHeader('Number').field, 'phone');
  assert.equal(matchHeader('Interview Date').field, 'interviewDate');
});

// ── analyser ────────────────────────────────────────────────────────────────
const HEAD = ['Sr no', 'Name of Candidate', 'Contact number', 'Position', 'Interview Date', 'Interview Time', 'Current CTC', 'Remarks', 'Recruiter'];
const person = (i, extra = {}) => [i, `Asha Rao ${'ab'[i % 2]}`, 9800000000 + i, 'Sales Officer', d(2025, 3, 21), at(11), '25K', null, 'Naaz', ...[]].map((v, k) => (extra[k] !== undefined ? extra[k] : v));

test('analyser: an Interview Time column is a time, not an alternate phone', () => {
  const rows = [HEAD, ...Array.from({ length: 8 }, (_, i) => person(i))];
  const a = analyseSheet({ name: 'DL', rows }, opts);
  const col = a.columns.find((c) => c.label === 'Interview Time');
  assert.equal(col.field, 'interviewTime');
  assert.ok(a.records.every((r) => r.candidate.altPhone === null));
  assert.equal(a.records[0].tracker.interviewTime, '11:00');
});

test('analyser: an unlabeled time column is still recognised, and never becomes a phone or a date', () => {
  const rows = [['Name', 'Mobile', 'Position', 'Interview Date', null], ...Array.from({ length: 5 }, (_, i) => [`Ravi K${i}`, 9811000000 + i, 'Cashier', d(2026, 11, 3), at(10, 30)])];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.equal(a.columns.find((c) => c.index === 4).field, 'interviewTime');
  assert.equal(a.records[0].candidate.altPhone, null);
});

test('analyser: "Sourcing Date" is kept as an extra detail, not mistaken for a phone or a lineup date', () => {
  const rows = [['Name', 'Contact', 'Sourcing Date', 'Interview date'], ...Array.from({ length: 4 }, (_, i) => [`Meera S${i}`, 9822000000 + i, d(2026, 10, 30), d(2026, 11, 2)])];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.equal(a.columns.find((c) => c.label === 'Sourcing Date').field, 'sourcingDate');
  assert.equal(a.records[0].custom.sourcingDate, '2026-10-30');
  assert.equal(a.records[0].candidate.altPhone, null);
  assert.equal(a.records[0].tracker.lineupDate, null);
});

test('analyser: a rescheduled interview is another lineup, only an exact repeat is a duplicate', () => {
  const base = ['Dev Patel', 9555500001, 'Sales Officer'];
  const rows = [['Name', 'Phone', 'Position', 'Interview Date'],
    [...base, d(2025, 3, 21)], [...base, d(2025, 3, 24)], [...base, d(2025, 3, 24)]];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.deepEqual(a.records[1].issues.map((i) => i.code), ['same_candidate']);
  assert.deepEqual(a.records[2].issues.map((i) => i.code), ['duplicate_row']);
});

test('analyser: a far-off year is warned about, the date is kept', () => {
  const rows = [['Name', 'Phone', 'Interview Date'], ['Himanshu Gupta', 9580000001, d(2002, 7, 10)], ['Neha Jain', 9580000002, d(2026, 7, 10)]];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.ok(a.records[0].issues.some((i) => i.code === 'odd_date'));
  assert.equal(a.records[0].tracker.interviewDate, '2002-07-10');
  assert.ok(!a.records[1].issues.some((i) => i.code === 'odd_date'));
});

test('analyser: the "dates could be read two ways" notice only appears when they really could', () => {
  const real = analyseSheet({ name: 'S', rows: [['Name', 'Phone', 'Interview Date'], ['Asha Rao', 9811111111, d(2026, 10, 5)]] }, opts);
  assert.ok(!real.warnings.some((w) => w.code === 'date_order_assumed'));
  const text = analyseSheet({ name: 'S', rows: [['Name', 'Phone', 'Interview Date'], ['Asha Rao', 9811111111, '05/10/2026']] }, opts);
  assert.ok(text.warnings.some((w) => w.code === 'date_order_assumed'));
});

// A salary typed under Status, "Reached" typed under Recruiter and under Remarks, a Remarks column that is also the expected salary.
test('analyser: values are sorted by what they are, not by the heading above them', () => {
  const rows = [['Name', 'Phone', 'Position', 'Interview Date', 'Current CTC', 'Expected CTC', 'Recruiter'],
    ['Asha Rao', 9811111101, 'Cashier', d(2026, 10, 1), '20K', 'Reached', 'Naaz'],
    ['Bela Roy', 9811111102, 'Cashier', d(2026, 10, 1), '18K', 'No Show', 'Naaz'],
    ['Chitra Das', 9811111103, 'Cashier', d(2026, 10, 1), '3 LPA', '22000', 'Reached'],
    ['Disha Jha', 9811111104, 'Cashier', d(2026, 10, 1), '25K', 'Rejected', 'Navya'],
    ['Esha Nair', 9811111105, 'Cashier', d(2026, 10, 1), '19K', 'Not Reached', 'Navya']];
  const a = analyseSheet({ name: 'S', rows }, opts);
  const exp = a.columns.find((c) => c.label === 'Expected CTC');
  assert.equal(exp.field, 'status'); assert.equal(exp.status, 'review'); assert.match(exp.note, /look like statuses/);
  const [r1, r2, r3, r4] = a.records;
  assert.equal(r1.tracker.stageKey, 'turnup');
  assert.equal(r2.tracker.trackerStatus, 'rejected'); assert.equal(r2.tracker.reason, 'No show');
  assert.equal(r3.custom.expectedCtc, '22000');         // a salary under Status is a salary
  assert.equal(r3.tracker.recruiterName, null);         // "Reached" under Recruiter is a status, not a person
  assert.equal(r3.tracker.statusText, 'Reached'); // …and it is read as the status, which the Status cell did not have
  assert.equal(r4.tracker.recruiterName, 'Navya');
  assert.ok(a.records.every((r) => !r.issues.some((i) => i.code === 'unknown_status')));
});

test('analyser: a Remarks column used for statuses and salaries feeds both', () => {
  const rows = [['Name', 'Phone', 'Position', 'Interview Date', 'Remarks'],
    ['Asha Rao', 9811111101, 'Cashier', d(2026, 10, 1), 'Reached'], ['Bela Roy', 9811111102, 'Cashier', d(2026, 10, 1), '25K'],
    ['Chitra Das', 9811111103, 'Cashier', d(2026, 10, 1), 'No show'], ['Disha Jha', 9811111104, 'Cashier', d(2026, 10, 1), 'Rejected'],
    ['Esha Nair', 9811111105, 'Cashier', d(2026, 10, 1), 'asked to call after 5 pm, wants a day shift']];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.equal(a.columns.find((c) => c.label === 'Remarks').field, 'remarks');
  assert.equal(a.records[0].tracker.stageKey, 'turnup');
  assert.equal(a.records[1].custom.expectedCtc, '25K'); assert.equal(a.records[1].tracker.remarks, null);
  assert.equal(a.records[2].tracker.trackerStatus, 'rejected');
  assert.equal(a.records[4].tracker.remarks, 'asked to call after 5 pm, wants a day shift'); // long notes stay notes
  assert.equal(a.records[4].tracker.statusText, null);
});

test('analyser: headings that stop one column short — the unheaded columns after them are found by their contents', () => {
  const rows = [['Name', 'Phone', 'Position', 'Interview Date', 'Current CTC', 'Expected CTC', null, null],
    ['Asha Rao', 9811111101, 'Cashier', d(2026, 10, 1), '20K', 'Reached', 'Naaz', 'Call not picked'],
    ['Bela Roy', 9811111102, 'Cashier', d(2026, 10, 1), '18K', 'No Show', 'Navya', 'Will come tomorrow'],
    ['Chitra Das', 9811111103, 'Cashier', d(2026, 10, 1), '3 LPA', 'Reached', 'Naaz', 'Salary 4 Lac'],
    ['Disha Jha', 9811111104, 'Cashier', d(2026, 10, 1), '25K', 'Rejected', 'Siddhi', 'Not suitable']];
  const a = analyseSheet({ name: 'S', rows }, opts);
  const f = (i) => a.columns.find((c) => c.index === i);
  assert.equal(f(5).field, 'status'); assert.equal(f(6).field, 'recruiter'); assert.equal(f(7).field, 'remarks');
  assert.equal(f(6).status, 'review');   // a guess: the wizard asks HR to check it
  assert.equal(a.records[0].tracker.recruiterName, 'Naaz');
  assert.equal(a.records[1].tracker.remarks, 'Will come tomorrow');
});

test('analyser: a correct heading is left alone', () => {
  const rows = [['Name', 'Phone', 'Position', 'Interview Date', 'Expected CTC', 'Recruiter'],
    ...Array.from({ length: 5 }, (_, i) => [`Asha R${i}`, 9811111100 + i, 'Cashier', d(2026, 10, 1), `${20 + i}K`, 'Naaz'])];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.equal(a.columns.find((c) => c.label === 'Expected CTC').field, 'expectedCtc');
  assert.equal(a.columns.find((c) => c.label === 'Recruiter').field, 'recruiter');
  assert.ok(a.columns.every((c) => !c.note));
});

test('analyser: a second table with its own headings is read with its own columns', () => {
  const rows = [
    ['Sr no', 'Name of Candidate', 'Contact number', 'Position', 'Interview Date'],
    [1, 'Asha Rao', 9811111101, 'Cashier', d(2026, 10, 1)],
    ['Sr no', 'Name of Candidate', 'Contact number', 'Position', 'Interview Date'],     // same heading again: just a repeat
    [2, 'Bela Roy', 9811111102, 'Cashier', d(2026, 10, 2)],
    [null, null, null, null, null],
    ['Name of Candidate', 'Number', 'Position', 'Location', 'Interview Date'],           // different heading, columns moved
    ['Chitra Das', 9811111103, 'Cashier', 'Noida', d(2026, 10, 3)],
    ['Disha Jha', 9811111104, 'Cashier', 'Noida', d(2026, 10, 4)],
  ];
  const a = analyseSheet({ name: 'UP', rows }, opts);
  assert.equal(a.records.length, 4);
  assert.deepEqual(a.records.map((r) => r.candidate.firstName), ['Asha', 'Bela', 'Chitra', 'Disha']);
  assert.equal(a.records[2].candidate.phone, '9811111103');
  assert.equal(a.records[3].tracker.interviewDate, '2026-10-04');
  assert.equal(a.summary.errors, 0);
  assert.deepEqual(a.tables, [{ headerRow: 1 }, { headerRow: 6 }]);
  assert.ok(a.warnings.some((w) => w.code === 'extra_table'));
});

test('analyser: single-table sheets are unchanged (no tables note, no warning)', () => {
  const a = analyseSheet({ name: 'S', rows: [['Name', 'Phone'], ['Asha Rao', 9811111101]] }, opts);
  assert.equal(a.tables, undefined); assert.ok(!a.warnings.some((w) => w.code === 'extra_table'));
});

// ── clients from tab / file names ───────────────────────────────────────────
test('client hint: file names are cleaned, generic tab names are recognised', () => {
  assert.equal(nameFromFile('HDFC_Delhi_Tracker_20-03-2025_____.xlsx'), 'HDFC Delhi');
  assert.equal(nameFromFile('Highspring_Sukrsh__Daily_Tracker_.xlsx'), 'Highspring Sukrsh');
  assert.equal(nameFromFile('Daily Tracker 2026.csv'), '');
  for (const n of ['Sheet1', 'Sheet2', 'Extra', '13-10-2026', '5', 'Lineup 2']) assert.equal(isGenericSheetName(n), true, n);
  for (const n of ['L&T Finance', 'Zepto Cafe', 'Highspring LLP', 'DL NCR']) assert.equal(isGenericSheetName(n), false, n);
});

test('client hint: tab names when they all look like clients, else the file name, else nothing', () => {
  assert.deepEqual(suggestClient('Outsourcing_Tracker.xlsx', [{ name: 'L&T Finance', kind: 'lineup' }, { name: 'Zepto Cafe', kind: 'candidates' }]), { mode: 'sheet', name: null });
  assert.deepEqual(suggestClient('HDFC_Delhi_Tracker.xlsx', [{ name: 'DL NCR', kind: 'lineup' }, { name: 'Sheet2', kind: 'lineup' }]), { mode: 'name', name: 'HDFC Delhi' });
  assert.deepEqual(suggestClient('Daily Tracker.xlsx', [{ name: 'Sheet1', kind: 'lineup' }]), { mode: 'none', name: null });
  assert.deepEqual(suggestClient('x.xlsx', [{ name: 'Notes', kind: 'unknown' }, { name: 'Sheet1', kind: 'lineup' }]).mode, 'name');
});

test('client hint: what the caller asks for wins; no answer means none', () => {
  const sheets = [{ name: 'L&T Finance', kind: 'lineup' }];
  assert.equal(resolveClient(undefined, 'f.xlsx', sheets).mode, 'none');
  assert.equal(resolveClient({ mode: 'auto' }, 'f.xlsx', sheets).mode, 'sheet');
  assert.deepEqual(resolveClient({ mode: 'name', name: '  Axis  Bank ' }, 'f.xlsx', sheets).name, 'Axis Bank');
  assert.equal(resolveClient({ mode: 'name', name: '' }, 'Zepto_Tracker.xlsx', sheets).name, 'Zepto');   // empty name falls back to the file's
  assert.equal(resolveClient({ mode: 'none' }, 'f.xlsx', sheets).mode, 'none');
});

const noClientRows = (n = 3) => [['Name', 'Phone', 'Position', 'Interview Date'], ...Array.from({ length: n }, (_, i) => [`Asha R${i}`, 9811111100 + i, 'Cashier', d(2026, 10, 1 + i)])];

test('workbook: tab names become clients on every lineup tab that has no client column', () => {
  const r = analyseWorkbook([{ name: 'L&T Finance', rows: noClientRows() }, { name: 'Zepto Cafe', rows: noClientRows(2) }], { ...opts, clientMode: 'sheet', fileName: 'Outsourcing_Tracker.xlsx' });
  assert.deepEqual(r.sheets.map((s) => s.records[0].tracker.clientName), ['L&T Finance', 'Zepto Cafe']);
  assert.deepEqual(r.sheets[0].summary.clients, [{ name: 'L&T Finance', count: 3 }]);
  assert.equal(r.client.mode, 'sheet'); assert.equal(r.client.needed, true); assert.deepEqual(r.client.sheetNames, ['L&T Finance', 'Zepto Cafe']);
});

test('workbook: one named client, auto, and none', () => {
  const sheets = () => [{ name: 'DL NCR', rows: noClientRows() }, { name: 'Sheet2', rows: noClientRows() }];
  const one = analyseWorkbook(sheets(), { ...opts, clientMode: 'name', clientName: 'HDFC Delhi', fileName: 'x.xlsx' });
  assert.ok(one.sheets.every((s) => s.records.every((r) => r.tracker.clientName === 'HDFC Delhi')));
  const auto = analyseWorkbook(sheets(), { ...opts, clientMode: 'auto', fileName: 'HDFC_Delhi_Tracker_20-03-2025.xlsx' });
  assert.equal(auto.client.mode, 'name'); assert.equal(auto.client.name, 'HDFC Delhi'); assert.equal(auto.client.source, 'auto');
  const none = analyseWorkbook(sheets(), { ...opts, fileName: 'HDFC_Delhi_Tracker.xlsx' });   // API callers who say nothing get what they always got
  assert.equal(none.sheets[0].records[0].tracker.clientName, null); assert.equal(none.client.mode, 'none'); assert.equal(none.client.suggestion.name, 'HDFC Delhi');
});

test('workbook: a sheet with its own Client column is never overwritten, and needs no choice', () => {
  const rows = [['Name', 'Phone', 'Client', 'Position'], ['Asha Rao', 9811111101, 'Axis Bank', 'Cashier'], ['Bela Roy', 9811111102, null, 'Cashier']];
  const r = analyseWorkbook([{ name: 'Oct', rows }], { ...opts, clientMode: 'name', clientName: 'Other', fileName: 'x.xlsx' });
  assert.equal(r.client.needed, false);
  assert.deepEqual(r.sheets[0].records.map((x) => x.tracker.clientName), ['Axis Bank', null]);
});

test('workbook: candidate-only sheets (no lineup data) get no client', () => {
  const rows = [['Name', 'Phone'], ['Asha Rao', 9811111101]];
  const r = analyseWorkbook([{ name: 'Names', rows }], { ...opts, clientMode: 'name', clientName: 'Axis', fileName: 'x.xlsx' });
  assert.equal(r.sheets[0].records[0].tracker, null); assert.equal(r.client.needed, false);
});

// ── plan and commit ─────────────────────────────────────────────────────────
const STAGES = [['applied', 0], ['screening', 1], ['lineup', 2], ['turnup', 3], ['interview', 4], ['offer', 5], ['joined', 6]].map(([stageKey, orderIndex]) => ({ stageKey, orderIndex }));
const catalog = () => ({ clients: [], users: [], candidates: [], locations: [], positions: [], stages: STAGES, liveTags: [], permissions: {} });

test('plan: the interview time travels with the tracker; the commit keeps it in the notes', () => {
  const rows = [['Name', 'Phone', 'Position', 'Interview Date', 'Interview Time', 'Remarks'], ['Asha Rao', 9811111101, 'Cashier', d(2026, 11, 3), at(11), 'Wants day shift']];
  const p = buildPlan({ sheets: [analyseSheet({ name: 'S', rows }, opts)], catalog: catalog(), opts: { now: NOW } });
  assert.equal(p.rows[0].plan.tracker.interviewTime, '11:00');
  assert.equal(trackerNotes(p.rows[0].plan.tracker), 'Wants day shift · Interview time 11:00');
  assert.equal(trackerNotes({ remarks: null, interviewTime: null }), null);
  assert.equal(trackerNotes({ remarks: null, interviewTime: '10:00' }), 'Interview time 10:00');
});

test('plan: with a client from the tab name, rows carry the client and an open position is planned', () => {
  const r = analyseWorkbook([{ name: 'L&T Finance', rows: noClientRows(2) }], { ...opts, clientMode: 'sheet', fileName: 'x.xlsx' });
  const p = buildPlan({ sheets: r.sheets, catalog: catalog(), opts: { now: NOW } });
  assert.equal(p.entities.clients.length, 1); assert.equal(p.entities.clients[0].label, 'L&T Finance');
  assert.equal(p.entities.positions.length, 1);
  assert.equal(p.summary.clients.new, 1); assert.equal(p.summary.positions.new, 1);
});
