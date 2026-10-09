const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { composeSchema } = require('../src/features/mail/mail.schema');
const { createTemplateSchema, updateTemplateSchema } = require('../src/features/mail/templates.schema');
const { isKnownKey, labelFor, resolveValue, describeCatalogue } = require('../src/features/mail/columns');
const { renderTrackerMail } = require('../src/services/email/templates/trackerTable');

const UUID = '11111111-1111-4111-8111-111111111111';
const tracker = {
  candidateName: 'Asha K', candidatePhone: '+919800000001', candidateLocation: 'Pune',
  openPositionDesignation: 'Sales Executive', clientName: 'Acme',
  lineupDate: '2026-10-14T05:00:00.000Z', interviewDate: null,
  currentStage: { stageKey: 'turnup', name: 'Turn up' }, currentStageNote: '',
};
const ctx = { tz: 'Asia/Kolkata', candidate: { email: 'a@x.com', customFields: { current_ctc: '3.2 LPA', current_employer: 'ICICI' } } };

test('tracker routes require authentication', async () => {
  for (const [m, p] of [['get', '/api/v1/mail/columns'], ['get', '/api/v1/mail/templates'], ['post', '/api/v1/mail/templates'], ['delete', `/api/v1/mail/templates/${UUID}`]]) {
    assert.equal((await request(app)[m](p)).status, 401, `${m} ${p}`);
  }
});

test('catalogue: known keys, free custom fields, nothing else', () => {
  assert.ok(isKnownKey('candidate_name') && isKnownKey('cf:current_ctc') && isKnownKey('cf:blood_group'));
  assert.ok(!isKnownKey('password') && !isKnownKey('cf:Bad Key') && !isKnownKey('cf:'));
  assert.ok(describeCatalogue().every((c) => c.key && c.label && c.group && !c.get));
});

test('columns resolve to what the client should read', () => {
  assert.equal(resolveValue('candidate_name', tracker, ctx), 'Asha K');
  assert.equal(resolveValue('lineup_time', tracker, ctx), '10:30 am');
  assert.equal(resolveValue('interview_date', tracker, ctx), '', 'no interview date → empty cell, not "Invalid Date"');
  assert.equal(resolveValue('stage', tracker, ctx), 'Reached', 'Turn up is worded Reached outside the app');
  assert.equal(resolveValue('cf:current_ctc', tracker, ctx), '3.2 LPA');
  assert.equal(resolveValue('cf:notice_period', tracker, ctx), '');
  assert.equal(labelFor('cf:blood_group'), 'Blood group');
  assert.equal(labelFor('mobile', ' Phone '), 'Phone');
});

test('template schema rejects unknown/duplicate columns and empty edits', () => {
  const good = { name: 'Interview', columns: [{ key: 'candidate_name' }, { key: 'mobile', label: 'Phone' }] };
  assert.ok(createTemplateSchema.shape.body.safeParse(good).success);
  assert.ok(!createTemplateSchema.shape.body.safeParse({ ...good, columns: [] }).success);
  assert.ok(!createTemplateSchema.shape.body.safeParse({ ...good, columns: [{ key: 'nope' }] }).success);
  assert.ok(!createTemplateSchema.shape.body.safeParse({ ...good, columns: [{ key: 'mobile' }, { key: 'mobile' }] }).success);
  assert.ok(!updateTemplateSchema.shape.body.safeParse({}).success);
  assert.ok(updateTemplateSchema.shape.body.safeParse({ isDefault: true }).success);
});

test('compose accepts the tracker type with a template or per-send columns', () => {
  const b = composeSchema.shape.body;
  assert.ok(b.safeParse({ type: 'tracker', trackerIds: [UUID], templateId: UUID }).success);
  assert.ok(b.safeParse({ type: 'tracker', trackerIds: [UUID], columns: [{ key: 'location' }] }).success);
  assert.ok(!b.safeParse({ type: 'tracker', trackerIds: [UUID], columns: [] }).success);
  assert.ok(!b.safeParse({ type: 'tracker', trackerIds: [UUID], columns: [{ key: 'drop_table' }] }).success);
});

test('tracker table: bordered Excel-style HTML, aligned text, pasteable TSV — same cells', () => {
  const columns = [{ label: 'Name' }, { label: 'Mobile' }, { label: 'Remarks' }];
  const rows = [['Asha K', '+919800000001', ''], ['Ravi <b>M</b>', '+919800000002', 'Bring ID\tproof']];
  const m = renderTrackerMail({ clientName: 'A&B', title: 'Interview — A&B', columns, rows, senderName: '<i>Priya</i>', orgName: 'Zenith' });
  assert.ok(m.html.includes('border:1px solid #bfbfbf') && m.html.includes('<th'));
  assert.ok(!m.html.includes('<b>M</b>') && !m.html.includes('<i>Priya</i>'), 'user-typed text is escaped');
  assert.ok(m.html.includes('A&amp;B'));
  assert.equal(m.tsv.split('\n').length, 3);
  assert.ok(m.tsv.split('\n').every((l) => l.split('\t').length === 3), 'tabs inside a cell never add a column');
  assert.ok(m.text.includes('Name') && m.text.includes('Ravi <b>M</b>'), 'plain text is not HTML-escaped');
  assert.equal(m.subject, 'Interview — A&B');
});
