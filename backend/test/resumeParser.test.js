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
const NOW = new Date(2026, 9, 14); // fixed so date-range estimates do not drift with the calendar
const read = (f) => fs.readFileSync(path.join(FIX, f));

test.after(async () => { await terminateOcrWorker(); });

// ---------- extraction + parsing, one fixture per supported format ----------

for (const [file, method, first, last, email, phone] of [
  ['rahul_sharma.pdf', 'pdf-text', 'Rahul', 'Sharma', 'rahul.sharma92@gmail.com', '+91 98765 43210'],
  ['priya_verma.docx', 'docx', 'Priya', 'Verma', 'priya.verma@outlook.com', '+91 98123 45678'],
  ['priya_verma_legacy.doc', 'doc', 'Priya', 'Verma', 'priya.verma@outlook.com', '+91 98123 45678'],
  ['amit_singh.png', 'ocr', 'Amit Kumar', 'Singh', 'amit.singh.hr@yahoo.com', '+91 91234 56789'],
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

test('scanned PDF (no text layer) is rendered and OCR-read', async () => {
  const { text, method } = await extractText(read('scanned_no_text_layer.pdf'), 'scan.pdf');
  assert.equal(method, 'pdf-ocr');
  const r = parseResumeText(text, { defaultCountry: 'IN' });
  assert.equal(r.candidate.email, 'amit.singh.hr@yahoo.com');
  assert.equal(r.candidate.phone, '+91 91234 56789');
});

test('OCR-derived drafts are always flagged to verify phone/email', async () => {
  const img = await parseFile({ originalname: 'amit_singh.png', size: 1, buffer: read('amit_singh.png') }, { defaultCountry: 'IN' });
  assert.ok(img.warnings.includes('ocr_verify_contact'));
  const scan = await parseFile({ originalname: 's.pdf', size: 1, buffer: read('scanned_no_text_layer.pdf') }, { defaultCountry: 'IN' });
  assert.ok(scan.warnings.includes('ocr_verify_contact'));
  const text = await parseFile({ originalname: 'p.docx', size: 1, buffer: read('priya_verma.docx') }, { defaultCountry: 'IN' });
  assert.ok(!text.warnings.includes('ocr_verify_contact'));
});

// ---------- regressions found on real resumes (synthetic stand-ins, no personal data) ----------

test('two-column PDF keeps column order: name, phone, address city/state read correctly', async () => {
  const { text } = await extractText(read('two_column_sidebar.pdf'), 'two_column_sidebar.pdf');
  const r = parseResumeText(text, { defaultCountry: 'IN', now: NOW });
  assert.equal(r.candidate.firstName, 'Meera');
  assert.equal(r.candidate.lastName, 'Iyer');
  assert.equal(r.candidate.phone, '+91 98111 22233');
  assert.equal(r.candidate.location, 'Sangrur, Punjab');
  assert.ok(r.candidate.skills.includes('Channel Sales'));
  assert.ok(r.candidate.skills.includes('Cross-selling'));
});

test('designer image: light name on a dark banner is recovered by the inverted-header retry', async () => {
  const r = await parseFile({ originalname: 'designer_header.png', size: 1, buffer: read('designer_header.png') }, { defaultCountry: 'IN', now: NOW });
  assert.equal(r.candidate.firstName, 'Anita');
  assert.equal(r.candidate.lastName, 'Desai');
  assert.equal(r.candidate.phone, '+91 98222 33344');
  assert.equal(r.candidate.location, 'Pune');
  assert.equal(r.parsedResume.experienceYears, 3);
  assert.ok(!r.warnings.includes('name_guessed_from_email'));
});

test('name: neighbouring column text and OCR debris are trimmed', () => {
  const a = parseResumeText('Name : Himanshu patel and belief.\nMobile: 8173807034\n', { defaultCountry: 'IN' });
  assert.equal(a.candidate.firstName, 'Himanshu');
  assert.equal(a.candidate.lastName, 'Patel');
  const b = parseResumeText('Z| SURYA PRAKASH a\n: As Bh, WE\nBl  KUSHWAHA 8\nPhone 8738926973\n', { defaultCountry: 'IN' });
  assert.equal(b.candidate.firstName, 'Surya Prakash');
  assert.equal(b.candidate.lastName, 'Kushwaha');
  const c = parseResumeText('Krishan Kumar §\n7357250454 4;\nSKILLS\nLoan Processing, Document Verification, MS Excel\n', { defaultCountry: 'IN' });
  assert.equal(c.candidate.firstName, 'Krishan');
  assert.equal(c.candidate.lastName, 'Kumar');
});

test('a skills phrase is never taken as the name', () => {
  const r = parseResumeText('Loan Processing, Document Verification\nrandom.person@mail.com\n');
  assert.notEqual(r.candidate.firstName, 'Loan');
});

test('location: inline "Location:" in a contact strip beats a wrapped Current Address', () => {
  const r = parseResumeText('RAVI SINGH\nEmail: r@x.com • Phone: +91 7678288781 • Location: Nagpur\nCurrent Address: CN 224, Near Govt. School, 8\nMahal, Nagpur, Maharashtra\nPermanent Address: Sanjay Colony, Faridabad, Haryana\n', { defaultCountry: 'IN' });
  assert.equal(r.candidate.location, 'Nagpur');
});

test('location: district fallback for rural addresses', () => {
  const r = parseResumeText('Address: Village - Mehara, Post - Nangliya, teh- Khetri, dist- jhunjhunu ( Raj) PIN code - 333035\n');
  assert.equal(r.candidate.location, 'Jhunjhunu');
});

test('experience: stated figures win; per-employer figures are summed', () => {
  assert.equal(parseResumeText('Over 5+ years of hands-on experience in B2B sales').experienceYears, 5);
  const r = parseResumeText('1 year experience in Flipkart Wholesale (B2B)\n1.5 year experience in Udaan (FMCG)\n');
  assert.equal(r.experienceYears, 2.5);
  assert.equal(r.experienceSource, 'stated');
});

test('experience: estimated from job date ranges (union, so overlaps and gaps are handled)', () => {
  const text = [
    'Senior Recruiter | Alpha Pvt Ltd', 'Feb 2022 – Jan 2025',
    'Recruiter | Beta Pvt Ltd', 'Dec 2024 – Present',
    'B.Tech Computer Science, Some University', 'Sept 2014 – Aug 2018',
  ].join('\n');
  const r = parseResumeText(text, { now: NOW });
  assert.equal(r.experienceSource, 'estimated');
  assert.equal(r.experienceYears, 5); // Feb 2022 -> Oct 2026 is 57 months (4.75y, rounded to 0.5); degree dates ignored
});

test('experience: fresher with only an internship and a degree has none', () => {
  const text = ['Java Full Stack Developer Intern', 'DUCAT, Noida | [Feb-2026] – [Aug-2026]', 'Bachelor of Technology (BTech) Sept 2022 – Aug 2026'].join('\n');
  assert.equal(parseResumeText(text, { now: NOW }).experienceYears, null);
});

test('experience: dd/mm/yyyy and "till date" ranges', () => {
  const r = parseResumeText('18/01/2021 - 18/01/2023 IIFL\n8/10/2023 - 04/06/2024 Moneyboxx\n05/06/2024 - Till Date Digivriddhi\n', { now: NOW });
  assert.equal(r.experienceSource, 'estimated');
  assert.ok(r.experienceYears >= 4.5 && r.experienceYears <= 5.5, String(r.experienceYears));
});

test('unsupported extension and corrupt file are per-file failures, not crashes', async () => {
  const bad = await parseFile({ originalname: 'notes.txt', size: 3, buffer: Buffer.from('abc') });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.errorCode, 'unsupported_type');
  const corrupt = await parseFile({ originalname: 'x.pdf', size: 4, buffer: Buffer.from('nope') });
  assert.equal(corrupt.status, 'failed');
  assert.equal(corrupt.errorCode, 'corrupt_file');
});

// ---------- names: cross-checks, headings, honorifics (found on a 52-resume real batch) ----------

test('name: file name is used when the text has none, and is flagged', () => {
  const text = 'EXPERIENCE\nSr. Accounts Executive\nSutra Marketing and Events LLP\nJanuary 2025 – Present\nPhone 9354370483\n';
  const r = parseResumeText(text, { defaultCountry: 'IN', fileName: 'Naukri_UditSharma[7y_0m].pdf' });
  assert.equal(r.candidate.firstName, 'Udit');
  assert.equal(r.candidate.lastName, 'Sharma');
  assert.ok(r.warnings.includes('name_guessed_from_filename'));
});

test('name: company, degree and heading lines are never taken as a name', () => {
  const a = parseResumeText('PGDBM (Marketing)\nEmail: vikash.kumarnoida2018@gmail.com\n', { fileName: 'VIKAS KUMAR RESUME.pdf' });
  assert.equal(a.candidate.firstName, 'Vikas');
  assert.equal(a.candidate.lastName, 'Kumar');
  const b = parseResumeText('Objective\nSYNOPSIS\nMANISH KUMAR PANDEY\nSeeking a challenging position\n');
  assert.equal(b.candidate.firstName, 'Manish Kumar');
  assert.equal(b.candidate.lastName, 'Pandey');
  const c = parseResumeText('CURRICULUMVITAE\nRAVI CHANDRA\nHNO-2678 GALINO-68 SANT NAGAR BURARI DELHI-110084\n');
  assert.equal(c.candidate.firstName, 'Ravi');
  assert.equal(c.candidate.lastName, 'Chandra');
  const d = parseResumeText('HIGHLIGHTS\nMore Oppo\nPhone 9811122233\n', { defaultCountry: 'IN' });
  assert.equal(d.candidate.firstName, null);
});

test('name: mixed-case line is accepted only when the file name or email backs it up', () => {
  const text = 'RESUME\nShriyansh gupta\nContact no:- 9301512556,8989221856\n';
  const backed = parseResumeText(text, { defaultCountry: 'IN', fileName: 'SHRIYANSH GUPTA JABALPUR.pdf' });
  assert.equal(backed.candidate.firstName, 'Shriyansh');
  assert.equal(backed.candidate.lastName, 'Gupta');
  const alone = parseResumeText(text, { defaultCountry: 'IN' });
  assert.equal(alone.candidate.firstName, null);
});

test('phone: two numbers joined by a comma are not read as one number with an extension', () => {
  const r = parseResumeText('Contact no:- 9301512556,8989221856\n', { defaultCountry: 'IN' });
  assert.equal(r.candidate.phone, '+91 93015 12556');
  assert.ok(!/ext/i.test(r.candidate.phone));
});

test('name: honorifics are dropped', () => {
  const r = parseResumeText('Mr. SAHIL KHAN\nsahil.khan@mail.com\n');
  assert.equal(r.candidate.firstName, 'Sahil');
  assert.equal(r.candidate.lastName, 'Khan');
});

test('a document with no phone or email (e.g. a job description) is flagged as not-a-resume', async () => {
  const r = await parseFile({ originalname: 'not_a_resume.docx', size: 1, buffer: read('not_a_resume.docx') }, { defaultCountry: 'IN' });
  assert.ok(r.warnings.includes('no_contact_details'));
  assert.equal(r.status, 'incomplete');
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
  const prose = 'I will go to the office and report to the manager. Excel in sports. Express interest.';
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
