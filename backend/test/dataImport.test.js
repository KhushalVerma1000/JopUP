const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const N = require('../src/features/data-import/normalize');
const { interpretStatus } = require('../src/features/data-import/statusMap');
const { matchHeader } = require('../src/features/data-import/headers');
const { analyseSheet, analyseWorkbook, findHeaderRow } = require('../src/features/data-import/analyse');
const { readWorkbook } = require('../src/features/data-import/reader');

const NOW = new Date(Date.UTC(2026, 9, 14));
const opts = { defaultCountry: 'IN', now: NOW };

// ── normalisers ───────────────────────────────────────────────────────────
test('dates: the usual HR spellings', () => {
  for (const [input, want] of [
    ['12 Oct 2026', '2026-10-12'], ['12-Oct-26', '2026-10-12'], ['Oct 12, 2026', '2026-10-12'], ['12th October 2026', '2026-10-12'],
    ['2026-10-12', '2026-10-12'], ['13/10/2026', '2026-10-13'], ['12 Oct', '2026-10-12'],
    [new Date(Date.UTC(2026, 9, 12)), '2026-10-12'], [46307, '2026-10-12'],
  ]) assert.equal(N.parseDate(input, { now: NOW }).date, want, String(input));
  assert.equal(N.parseDate('31/02/2026').date, null);
  assert.equal(N.parseDate('hello').date, null);
});

test('dates: day-first is assumed, flagged ambiguous, and settled by any unambiguous value', () => {
  assert.deepEqual(N.parseDate('05/10/2026'), { date: '2026-10-05', ambiguous: true });
  assert.equal(N.parseDate('05/10/2026', { order: 'mdy' }).date, '2026-05-10');
  assert.deepEqual(N.detectDateOrder(['05/10/2026', '13/10/2026']), { order: 'dmy', certain: true });
  assert.deepEqual(N.detectDateOrder(['05/10/2026', '10/13/2026']), { order: 'mdy', certain: true });
  assert.deepEqual(N.detectDateOrder(['05/10/2026']), { order: 'dmy', certain: false });
  assert.equal(N.detectDateOrder(['13/10/2026', '10/13/2026']).order, 'mixed');
});

test('phones: numbers, floats, formatting, two numbers in one cell, own country', () => {
  assert.equal(N.parsePhoneCell(9876543210, 'IN').phoneNormalized, '+919876543210');
  assert.equal(N.parsePhoneCell(9876543210.0, 'IN').phone, '9876543210');
  assert.equal(N.parsePhoneCell('98765-43210', 'IN').phoneNormalized, '+919876543210');
  const two = N.parsePhoneCell('98765 43210 / 91234 56789', 'IN');
  assert.equal(two.phoneNormalized, '+919876543210'); assert.equal(two.alt, '91234 56789');
  const uae = N.parsePhoneCell('+971 50 123 4567');
  assert.equal(uae.phoneCountry, 'AE'); assert.equal(uae.valid, true);
  const bad = N.parsePhoneCell('987654', 'IN');
  assert.equal(bad.valid, false); assert.equal(bad.phoneNormalized, null);
  assert.equal(N.parsePhoneCell('', 'IN').phone, null);
});

test('names, experience, email', () => {
  assert.deepEqual(N.splitName('MR. RAHUL KUMAR SHARMA'), { firstName: 'Rahul Kumar', lastName: 'Sharma' });
  assert.deepEqual(N.splitName('priya'), { firstName: 'Priya', lastName: null });
  assert.deepEqual(N.splitName('McDonald Reyes'), { firstName: 'McDonald', lastName: 'Reyes' });
  assert.equal(N.parseExperience('5y 8m'), 5.7);
  assert.equal(N.parseExperience('3 years'), 3);
  assert.equal(N.parseExperience('Fresher'), 0);
  assert.equal(N.parseExperience('2+'), 2);
  assert.equal(N.parseExperience('abc'), null);
  assert.equal(N.cleanEmail(' Rahul@Gmail.com ').email, 'rahul@gmail.com');
  assert.equal(N.cleanEmail('not an email').valid, false);
});

// ── status words ──────────────────────────────────────────────────────────
test('status: negatives beat the positive word they contain', () => {
  const t = (s) => { const r = interpretStatus(s); return [r.stageKey, r.status]; };
  assert.deepEqual(t('Not selected'), [null, 'rejected']);
  assert.deepEqual(t('Selected'), ['offer', 'active']);
  assert.deepEqual(t('Not reachable'), ['screening', 'rejected']);
  assert.deepEqual(t('No show'), ['lineup', 'rejected']);
  assert.deepEqual(t('Not interested'), [null, 'withdrawn']);
  assert.deepEqual(t('Joined'), ['joined', 'placed']);
  assert.deepEqual(t('Reached'), ['turnup', 'active']);
  assert.deepEqual(t('L2 cleared'), ['interview', 'active']);
  assert.deepEqual(t('Lined up'), ['lineup', 'active']);
  assert.deepEqual(t('On hold'), [null, 'on_hold']);
  assert.deepEqual(t('Offer released'), ['offer', 'active']);
});

test('status: keeps the sheet\'s own words as the reason, and honours HR\'s overrides', () => {
  assert.equal(interpretStatus('Rejected - salary mismatch').reason, 'Rejected - salary mismatch');
  assert.equal(interpretStatus('No show').reason, 'No show');
  assert.equal(interpretStatus('Zorblax').matched, null);
  const ov = { zorblax: { stageKey: 'interview', status: 'active' } };
  assert.deepEqual(interpretStatus('Zorblax!', ov).stageKey, 'interview');
  assert.equal(interpretStatus('Zorblax', ov).matched, 'override');
  assert.equal(interpretStatus('').matched, null);
});

// ── headers ───────────────────────────────────────────────────────────────
test('headers: synonyms and the cases that are easy to get wrong', () => {
  const f = (h) => (matchHeader(h) || {}).field;
  assert.equal(f('Candidate Name'), 'candidateName');
  assert.equal(f('Contact No.'), 'phone');
  assert.equal(f('Mobile'), 'phone');
  assert.equal(f('Alternate Contact No'), 'altPhone');
  assert.equal(f('E-mail ID'), 'email');
  assert.equal(f('Line up date'), 'lineupDate');
  assert.equal(f('Date of Interview'), 'interviewDate');
  assert.equal(f('DOJ'), 'joiningDate');
  assert.equal(f('Client Name'), 'client');
  assert.equal(f('Current Location'), 'location');
  assert.equal(f('Job Location'), 'clientLocation');
  assert.equal(f('Store'), 'clientLocation');
  assert.equal(f('Total Exp (Yrs)'), 'experience');
  assert.equal(f('Current CTC'), 'currentCtc');
  assert.equal(f('Expected CTC'), 'expectedCtc');
  assert.equal(f('Sr No'), 'srNo');
  assert.equal(f('Date'), 'genericDate');
  assert.equal(f('Favourite colour'), undefined);
});

// ── a realistic messy lineup sheet ────────────────────────────────────────
const MESSY = [
  ['ACME RECRUITMENT - DAILY LINEUP', null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ['Sr No', 'Candidate Name', 'Contact No', 'Client', 'Position', 'Job Location', 'Lineup Date', 'Status', 'Remarks'],
  [1, 'RAHUL SHARMA', 9876543210, 'Reliance Retail', 'Store Manager', 'Andheri', '13/10/2026', 'Reached', null],
  [2, 'priya verma', '98123 45678', 'Reliance Retail', 'Cashier', 'Andheri', '13/10/2026', 'No show', null],
  [3, 'Amit Kumar Singh', '91234 56789 / 90000 11111', 'Tata Trent', 'Sales Executive', 'Pune', '14/10/2026', 'Selected', 'Good communication'],
  [4, 'Rahul Sharma', 9876543210, 'Tata Trent', 'Sales Executive', 'Pune', '14/10/2026', 'Not selected', 'Salary mismatch'],
  [null, null, null, null, null, null, null, null, null],
  [5, 'Neha Gupta', 'abc', 'Tata Trent', 'Cashier', 'Pune', '14/10/2026', 'Zorblax', null],
  [6, null, null, 'Tata Trent', 'Cashier', 'Pune', '14/10/2026', 'Lined up', null],
  ['Total', 6, null, null, null, null, null, null, null],
];

test('analyser: finds the header under title rows and classifies the sheet', () => {
  assert.equal(findHeaderRow(MESSY), 2);
  const a = analyseSheet({ name: 'Lineups', rows: MESSY }, opts);
  assert.equal(a.kind, 'lineup');
  assert.equal(a.headerRow, 3);
  const field = (label) => a.columns.find((c) => c.label === label).field;
  assert.equal(field('Candidate Name'), 'candidateName');
  assert.equal(field('Contact No'), 'phone');
  assert.equal(field('Job Location'), 'clientLocation');
  assert.equal(field('Sr No'), 'srNo');
  assert.equal(a.columns.find((c) => c.label === 'Candidate Name').status, 'auto');
});

test('analyser: rows, repeats, statuses and the issues HR must see', () => {
  const a = analyseSheet({ name: 'Lineups', rows: MESSY }, opts);
  assert.equal(a.dateOrder.order, 'dmy'); assert.equal(a.dateOrder.certain, true); // 13/10 settles it
  assert.equal(a.records.length, 6);                       // blank row and Total row dropped
  const [rahul, priya, amit, rahul2, neha, noName] = a.records;
  assert.equal(rahul.candidate.firstName, 'Rahul'); assert.equal(rahul.candidate.lastName, 'Sharma');
  assert.equal(rahul.candidate.phoneNormalized, '+919876543210');
  assert.equal(rahul.tracker.lineupDate, '2026-10-13');
  assert.equal(rahul.tracker.stageKey, 'turnup');
  assert.equal(priya.tracker.trackerStatus, 'rejected'); assert.equal(priya.tracker.reason, 'No show');
  assert.equal(amit.candidate.altPhone, '90000 11111'); assert.equal(amit.tracker.stageKey, 'offer');
  // same person, second client: one candidate, two trackers, and not an error
  assert.equal(rahul2.duplicateOfRow, 4);
  assert.ok(rahul2.issues.some((i) => i.code === 'same_candidate'));
  assert.ok(!rahul2.issues.some((i) => i.level !== 'info'));
  assert.equal(rahul2.tracker.reason, 'Not selected');
  assert.equal(rahul2.tracker.remarks, 'Salary mismatch');
  // problems
  assert.deepEqual(neha.issues.map((i) => i.code).sort(), ['invalid_phone', 'unknown_status']);
  assert.ok(noName.blocking); assert.ok(noName.issues.some((i) => i.code === 'missing_name'));
  assert.equal(a.summary.people, 5);                       // 6 rows, Rahul twice
  assert.equal(a.summary.trackers, 6);
  assert.deepEqual(a.summary.clients.map((c) => [c.name, c.count]), [['Tata Trent', 4], ['Reliance Retail', 2]]);
  assert.deepEqual(a.summary.unknownStatuses.map((u) => [u.text, u.count]), [['Zorblax', 1]]);
});

test('analyser: HR\'s answer for an unknown status is applied on the next run', () => {
  const a = analyseSheet({ name: 'Lineups', rows: MESSY }, { ...opts, statusOverrides: { zorblax: { stageKey: 'interview', status: 'active' } } });
  assert.equal(a.summary.unknownStatuses.length, 0);
  assert.equal(a.records[4].tracker.stageKey, 'interview');
});

test('analyser: an exact repeat of the same lineup is a warning, not a second tracker', () => {
  const rows = [['Name', 'Phone', 'Client', 'Position', 'Lineup Date'],
    ['Rahul', '9876543210', 'Acme', 'Cashier', '13/10/2026'], ['Rahul', '9876543210', 'Acme', 'Cashier', '13/10/2026']];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.ok(a.records[1].issues.some((i) => i.code === 'duplicate_row' && i.level === 'warn'));
});

test('analyser: one tab per day — the tab name becomes the lineup date', () => {
  const rows = [['Name', 'Mobile', 'Client', 'Position', 'Status'], ['Rahul Sharma', 9876543210, 'Acme', 'Cashier', 'Lined up']];
  const a = analyseSheet({ name: '13-10-2026', rows }, opts);
  assert.equal(a.sheetDate, '2026-10-13');
  assert.equal(a.records[0].tracker.lineupDate, '2026-10-13');
  assert.equal(analyseSheet({ name: 'Sheet1', rows }, opts).sheetDate, null);
});

test('analyser: a plain candidate list is not a lineup', () => {
  const rows = [['Name', 'Phone', 'Email', 'Exp', 'Current CTC', 'Notice Period', 'Skills'],
    ['Priya Verma', '9812345678', 'Priya@Outlook.com', '3y 6m', '6.5 LPA', '30 days', 'Excel, Tally, GST']];
  const a = analyseSheet({ name: 'Database', rows }, opts);
  assert.equal(a.kind, 'candidates');
  const r = a.records[0];
  assert.equal(r.tracker, null);
  assert.equal(r.candidate.email, 'priya@outlook.com');
  assert.equal(r.candidate.experienceYears, 3.5);
  assert.deepEqual(r.candidate.skills, ['Excel', 'Tally', 'GST']);
  assert.equal(r.custom.currentCtc, '6.5 LPA'); assert.equal(r.custom.noticePeriod, '30 days');
});

test('analyser: unlabeled phone and email columns are recognised from their values', () => {
  const rows = [['Name', 'Client'], ['A One', 'Acme']];
  assert.equal(analyseSheet({ name: 'S', rows }, opts).kind, 'lineup');
  const rows2 = [['Name', 'Details', 'More', 'Client'],
    ['Aman Roy', 9876543210, 'aman@x.com', 'Acme'], ['Bina Das', 9123456789, 'bina@x.com', 'Acme'], ['Chet Rao', 9812345678, 'chet@x.com', 'Acme']];
  const a = analyseSheet({ name: 'S', rows: rows2 }, opts);
  assert.equal(a.columns.find((c) => c.label === 'Details').field, 'phone');
  assert.equal(a.columns.find((c) => c.label === 'More').field, 'email');
  assert.equal(a.columns.find((c) => c.label === 'Details').status, 'review'); // guessed, so HR is asked
});

test('analyser: a "Contact" column full of names is not trusted as a phone', () => {
  const rows = [['Name', 'Contact', 'Client'], ['Aman Roy', 'Ramesh Kumar', 'Acme'], ['Bina Das', 'Suresh', 'Acme']];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.notEqual(a.columns.find((c) => c.label === 'Contact').status, 'auto');
});

test('analyser: unrecognised columns are kept as extra fields, not lost', () => {
  const rows = [['Name', 'Phone', 'Client', 'Blood group'], ['Aman Roy', '9876543210', 'Acme', 'B+']];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.equal(a.records[0].custom['Blood group'], 'B+');
});

test('analyser: no headings at all is reported, not guessed', () => {
  const a = analyseSheet({ name: 'S', rows: [['Rahul', '9876543210'], ['Priya', '9812345678']] }, opts);
  assert.equal(a.kind, 'unknown');
  assert.equal(a.warnings[0].code, 'no_header');
});

test('analyser: dates settle a vague status; a joining date means joined', () => {
  const rows = [['Name', 'Phone', 'Client', 'Position', 'Lineup Date', 'Interview Date', 'DOJ'],
    ['A One', '9876543210', 'Acme', 'Cashier', '10/10/2026', '12/10/2026', null],
    ['B Two', '9123456789', 'Acme', 'Cashier', '10/10/2026', '12/10/2026', '20/10/2026']];
  const a = analyseSheet({ name: 'S', rows }, opts);
  assert.equal(a.records[0].tracker.stageKey, 'interview');
  assert.equal(a.records[1].tracker.stageKey, 'joined'); assert.equal(a.records[1].tracker.trackerStatus, 'placed');
});

test('workbook: totals across tabs', () => {
  const w = analyseWorkbook([{ name: 'Lineups', rows: MESSY }, { name: 'Notes', rows: [['just some text']] }], opts);
  assert.equal(w.totals.sheets, 2); assert.equal(w.totals.usableSheets, 1);
  assert.equal(w.totals.rows, 6);
});

// ── file reading ──────────────────────────────────────────────────────────
test('reader: xlsx keeps dates as dates and phones as numbers; hidden tabs are skipped', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('13-10-2026');
  ws.addRow(['Name', 'Mobile', 'Client', 'Position', 'Lineup Date', 'Status']);
  ws.addRow(['Rahul Sharma', 9876543210, 'Acme', 'Cashier', new Date(Date.UTC(2026, 9, 13)), 'Reached']);
  const hidden = wb.addWorksheet('scratch'); hidden.state = 'hidden'; hidden.addRow(['x']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { sheets } = await readWorkbook(buf, 'lineups.xlsx');
  assert.equal(sheets.length, 1);
  const a = analyseSheet(sheets[0], opts);
  assert.equal(a.records[0].tracker.lineupDate, '2026-10-13');
  assert.equal(a.records[0].candidate.phoneNormalized, '+919876543210');
});

test('reader: semicolon CSV with a BOM; legacy .xls and unknown types are refused kindly', async () => {
  const csv = Buffer.from('\uFEFFName;Phone;Client\nRahul Sharma;9876543210;Acme\n');
  const { sheets } = await readWorkbook(csv, 'a.csv');
  assert.deepEqual(sheets[0].rows[0], ['Name', 'Phone', 'Client']);
  assert.equal(analyseSheet(sheets[0], opts).records.length, 1);
  await assert.rejects(readWorkbook(Buffer.from('x'), 'old.xls'), /xlsx/);
  await assert.rejects(readWorkbook(Buffer.from('x'), 'a.pdf'), /Excel/);
  await assert.rejects(readWorkbook(Buffer.from('not a zip'), 'broken.xlsx'), /could not be opened/);
});

// ── HTTP layer (DB-dependent parts tolerate no Postgres, like the other suites) ──
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ORG = '11111111-1111-1111-1111-111111111111';
const token = (candidates = ['read', 'write']) => jwt.sign({
  userId: 'test-user', organisationId: ORG, email: 't@example.com',
  roles: [{ teamId: null, roleName: 'org_admin', permissions: { candidates } }],
}, JWT_SECRET, { expiresIn: '1h' });

const sheetBuffer = async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Lineups');
  MESSY.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

test('POST /api/v1/data-import/analyse requires auth', async () => {
  const res = await request(app).post('/api/v1/data-import/analyse').attach('file', await sheetBuffer(), 'l.xlsx');
  assert.equal(res.status, 401);
});

test('POST /api/v1/data-import/analyse is forbidden without candidates:write', async () => {
  const res = await request(app).post('/api/v1/data-import/analyse')
    .set('Authorization', `Bearer ${token(['read'])}`).attach('file', await sheetBuffer(), 'l.xlsx');
  assert.ok([403, 500, 503].includes(res.status), `Unexpected status ${res.status}`);
});

test('POST /api/v1/data-import/analyse returns the analysis (or tolerates missing DB)', async () => {
  const res = await request(app).post('/api/v1/data-import/analyse?defaultCountry=IN')
    .set('Authorization', `Bearer ${token()}`).attach('file', await sheetBuffer(), 'lineups.xlsx');
  if (res.status === 200) {
    const d = res.body.data;
    assert.equal(d.totals.rows, 6); assert.equal(d.sheets[0].kind, 'lineup');
    assert.ok(d.sheets[0].preview.length <= 25);
    assert.ok(!('records' in d.sheets[0]));
  } else {
    assert.ok([403, 500, 503].includes(res.status), `Unexpected status ${res.status}`);
  }
});

test('POST /api/v1/data-import/analyse rejects a bad defaultCountry and an unsupported file', async () => {
  const bad = await request(app).post('/api/v1/data-import/analyse?defaultCountry=INDIA')
    .set('Authorization', `Bearer ${token()}`).attach('file', await sheetBuffer(), 'l.xlsx');
  assert.ok([400, 403, 500, 503].includes(bad.status), `Unexpected status ${bad.status}`);
  const pdf = await request(app).post('/api/v1/data-import/analyse')
    .set('Authorization', `Bearer ${token()}`).attach('file', Buffer.from('%PDF'), 'cv.pdf');
  assert.ok([400, 403, 500, 503].includes(pdf.status), `Unexpected status ${pdf.status}`);
});
