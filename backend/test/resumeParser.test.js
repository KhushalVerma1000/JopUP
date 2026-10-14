const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { extractText, terminateOcrWorker, ExtractError } = require('../src/features/resume-parser/extract');
const { parseResumeText, extractSkills, cleanLines } = require('../src/features/resume-parser/fields');
const { parseFile, parseMany } = require('../src/features/resume-parser/resume-parser.service');
const app = require('../src/app');

const FIX = path.join(__dirname, 'fixtures', 'resumes');
const read = (f) => fs.readFileSync(path.join(FIX, f));

test.after(async () => { await terminateOcrWorker(); });

// ---------- extraction + parsing, one fixture per supported format ----------

for (const [file, method, first, last, email, phone] of [
  ['rahul_sharma.pdf', 'pdf-text', 'Rahul', 'Sharma', 'rahul.sharma92@gmail.com', '+91 98765 43210'],
  ['priya_verma.docx', 'docx', 'Priya', 'Verma', 'priya.verma@outlook.com', '+91 98123 45678'],
  ['priya_verma_legacy.doc', 'doc', 'Priya', 'Verma', 'priya.verma@outlook.com', '+91 98123 45678'],
  ['amit_singh.png', 'ocr', 'Amit', 'Kumar Singh', 'amit.singh.hr@yahoo.com', '+91 91234 56789'],
]) {
  test(`parses ${file} via ${method}`, async () => {
    const { text, method: m } = await extractText(read(file), file);
    assert.equal(m, method);
    const { candidate } = parseResumeText(text, { defaultCountry: 'IN' });
    assert.equal(candidate.firstName, first);
    assert.equal(candidate.lastName, last);
    assert.equal(candidate.email, email);
    assert.equal(candidate.phone, phone);
    assert.equal(candidate.phoneCountry, 'IN');
  });
}

test('PDF fixture also yields linkedin, location, skills and experience', async () => {
  const { text } = await extractText(read('rahul_sharma.pdf'), 'rahul_sharma.pdf');
  const r = parseResumeText(text, { defaultCountry: 'IN' });
  assert.equal(r.candidate.linkedinUrl, 'https://www.linkedin.com/in/rahul-sharma-dev');
  assert.equal(r.candidate.location, 'Noida, Uttar Pradesh');
  assert.equal(r.experienceYears, 5);
  for (const s of ['JavaScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'AWS', 'Go']) {
    assert.ok(r.candidate.skills.includes(s), `missing skill ${s}`);
  }
});

test('scanned PDF with no text layer is reported as needs_ocr', async () => {
  await assert.rejects(() => extractText(read('scanned_no_text_layer.pdf'), 'scan.pdf'), (e) => e instanceof ExtractError && e.code === 'needs_ocr');
});

test('unsupported extension and corrupt file are per-file failures, not crashes', async () => {
  const bad = await parseFile({ originalname: 'notes.txt', size: 3, buffer: Buffer.from('abc') });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.errorCode, 'unsupported_type');
  const corrupt = await parseFile({ originalname: 'x.pdf', size: 4, buffer: Buffer.from('nope') });
  assert.equal(corrupt.status, 'failed');
  assert.equal(corrupt.errorCode, 'corrupt_file');
});

// ---------- field rules ----------

test('phone without +CC and without defaultCountry is kept but flagged (ADR-2: no country guessing)', () => {
  const r = parseResumeText('Neha Gupta\nneha.gupta@mail.com\nMobile: 9876501234\n');
  assert.equal(r.candidate.phoneCountry, null);
  assert.ok(r.warnings.includes('phone_country_unknown'));
});

test('explicit +CC wins over defaultCountry', () => {
  const r = parseResumeText('John Smith\njohn@corp.com\n+1 415 555 2671\n', { defaultCountry: 'IN' });
  assert.equal(r.candidate.phoneCountry, 'US');
});

test('name falls back to email local part with a warning', () => {
  const r = parseResumeText('objective: looking for a job in sales and marketing\nemail: karan.mehta@mail.com\n');
  assert.equal(r.candidate.firstName, 'Karan');
  assert.equal(r.candidate.lastName, 'Mehta');
  assert.ok(r.warnings.includes('name_guessed_from_email'));
});

test('missing contact details are surfaced as warnings', () => {
  const r = parseResumeText('Some Person\nExperienced professional\n');
  assert.ok(r.warnings.includes('missing_email'));
  assert.ok(r.warnings.includes('missing_phone'));
});

test('ambiguous skills (Go, R, C) only match inside skill lists, not prose', () => {
  const prose = 'I will go to the office and report to the manager. Excel in teamwork. Express interest.';
  assert.deepEqual(extractSkills(prose, cleanLines(prose)), []);
  const list = 'Skills: Python, Go, R, C, SQL';
  const s = extractSkills(list, cleanLines(list));
  for (const k of ['Python', 'Go', 'R', 'C', 'SQL']) assert.ok(s.includes(k), k);
});

test('java is not detected inside javascript', () => {
  const s = extractSkills('Worked with JavaScript daily', ['Worked with JavaScript daily']);
  assert.ok(s.includes('JavaScript'));
  assert.ok(!s.includes('Java'));
});

test('same person uploaded twice in one batch is flagged', async () => {
  const f = (name) => ({ originalname: name, size: 1, buffer: read('priya_verma.docx') });
  const results = await parseMany([f('a.docx'), f('b.docx')], { defaultCountry: 'IN' });
  assert.ok(!results[0].warnings.includes('duplicate_in_batch'));
  assert.ok(results[1].warnings.includes('duplicate_in_batch'));
  assert.equal(results[1].duplicateOfIndex, 0);
});

// ---------- HTTP layer (DB-dependent parts tolerate no Postgres, like the other suites) ----------

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ORG = '11111111-1111-1111-1111-111111111111';
const token = (candidates = ['read', 'write']) => jwt.sign({
  userId: 'test-user', organisationId: ORG, email: 't@example.com',
  roles: [{ teamId: null, roleName: 'org_admin', permissions: { candidates } }],
}, JWT_SECRET, { expiresIn: '1h' });

test('POST /api/v1/resume-parser/parse requires auth', async () => {
  const res = await request(app).post('/api/v1/resume-parser/parse').attach('files', read('priya_verma.docx'), 'p.docx');
  assert.equal(res.status, 401);
});

test('POST /api/v1/resume-parser/parse is forbidden without candidates:write', async () => {
  const res = await request(app).post('/api/v1/resume-parser/parse')
    .set('Authorization', `Bearer ${token(['read'])}`)
    .attach('files', read('priya_verma.docx'), 'p.docx');
  assert.ok([403, 500, 503].includes(res.status), `Unexpected status ${res.status}`);
});

test('POST /api/v1/resume-parser/parse returns drafts (or tolerates missing DB)', async () => {
  const res = await request(app).post('/api/v1/resume-parser/parse?defaultCountry=IN')
    .set('Authorization', `Bearer ${token()}`)
    .attach('files', read('priya_verma.docx'), 'priya.docx')
    .attach('files', read('rahul_sharma.pdf'), 'rahul.pdf');
  if (res.status === 200) {
    assert.equal(res.body.data.summary.total, 2);
    assert.equal(res.body.data.results[0].candidate.firstName, 'Priya');
  } else {
    assert.ok([403, 500, 503].includes(res.status), `Unexpected status ${res.status}`);
  }
});

test('POST /api/v1/resume-parser/bulk-create validates the body', async () => {
  const res = await request(app).post('/api/v1/resume-parser/bulk-create')
    .set('Authorization', `Bearer ${token()}`)
    .send({ ownerTeamId: 'not-a-uuid', items: [] });
  assert.ok([400, 403, 500, 503].includes(res.status), `Unexpected status ${res.status}`);
});
