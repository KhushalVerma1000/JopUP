const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { composeSchema } = require('../src/features/mail/mail.schema');
const { renderLineupMail, renderInterviewReminder, formatDay, formatTime } = require('../src/services/email/templates/lineup');

const UUID = '11111111-1111-4111-8111-111111111111';
const rows = [
  { name: 'Asha K', phone: '+919800000001', location: 'Pune', position: 'Sales Executive', time: '10:30 am' },
  { name: 'Ravi <b>M</b>', phone: '+919800000002', location: 'Mumbai', position: 'Sales Executive', time: '' },
  { name: 'Neha S', phone: '+919800000003', location: '', position: 'Accountant', time: '2:00 pm' },
];

test('compose requires authentication', async () => {
  const res = await request(app).post('/api/v1/mail/compose').send({});
  assert.equal(res.status, 401);
});

test('compose schema: needs ids, a known type, a YYYY-MM-DD date', () => {
  const ok = composeSchema.shape.body.safeParse({ type: 'lineup', trackerIds: [UUID], date: '2026-10-08' });
  assert.ok(ok.success);
  assert.ok(!composeSchema.shape.body.safeParse({ type: 'lineup', trackerIds: [] }).success);
  assert.ok(!composeSchema.shape.body.safeParse({ type: 'offer', trackerIds: [UUID] }).success);
  assert.ok(!composeSchema.shape.body.safeParse({ type: 'lineup', trackerIds: [UUID], date: '08/10/2026' }).success);
});

test('lineup mail groups by position and names the client and day', () => {
  const m = renderLineupMail({ clientName: 'Acme', dateLabel: 'Thu, 8 Oct 2026', rows, senderName: 'Priya', orgName: 'Zenith' });
  assert.equal(m.subject, 'Lineup for Thu, 8 Oct 2026 — Acme');
  assert.ok(m.text.indexOf('Sales Executive') < m.text.indexOf('Accountant'));
  assert.ok(m.text.includes('1. Asha K | +919800000001 | Pune | 10:30 am'));
  assert.ok(m.text.includes('2. Ravi <b>M</b> | +919800000002 | Mumbai'), 'plain text is not HTML-escaped');
  assert.ok(m.text.endsWith('Zenith'));
  assert.ok(m.whatsappText.startsWith('*Lineup for Thu, 8 Oct 2026*'));
});

test('lineup HTML escapes candidate-controlled text (this goes to clients)', () => {
  const m = renderLineupMail({ clientName: 'A&B', dateLabel: 'x', rows, senderName: '<i>x</i>', orgName: '' });
  assert.ok(!m.html.includes('<b>M</b>'));
  assert.ok(m.html.includes('Ravi &lt;b&gt;M&lt;/b&gt;'));
  assert.ok(m.html.includes('A&amp;B'));
  assert.ok(!m.html.includes('<i>x</i>'));
});

test('lineup mail with no client still reads naturally', () => {
  const m = renderLineupMail({ clientName: null, dateLabel: 'Thu, 8 Oct 2026', rows: rows.slice(0, 1), senderName: 'P', orgName: '' });
  assert.equal(m.subject, 'Lineup for Thu, 8 Oct 2026');
  assert.ok(m.text.startsWith('Hi,'));
});

test('interview reminder greets by first name and omits missing parts', () => {
  const m = renderInterviewReminder({ candidateName: 'Asha Kumar', position: 'Sales Executive', clientName: 'Acme', dayLabel: 'Thu, 8 Oct 2026', time: '10:30 am', location: '', senderName: 'Priya', orgName: '' });
  assert.equal(m.subject, 'Interview reminder — Sales Executive at Acme, Thu, 8 Oct 2026');
  assert.ok(m.text.startsWith('Hi Asha,'));
  assert.ok(m.text.includes('on Thu, 8 Oct 2026, 10:30 am'));
  assert.ok(!m.text.includes('Location:'));
  const bare = renderInterviewReminder({ candidateName: '', position: '', clientName: '', dayLabel: '', time: '', location: '', senderName: 'P', orgName: '' });
  assert.ok(bare.text.startsWith('Hi there,'));
});

test('day and time are written in the organisation timezone, and midnight means "no time set"', () => {
  const d = '2026-10-08T05:00:00.000Z'; // 10:30 in Kolkata, 05:00 UTC
  assert.equal(formatTime(d, 'Asia/Kolkata'), '10:30 am');
  assert.equal(formatTime('2026-10-07T18:30:00.000Z', 'Asia/Kolkata'), '', 'local midnight');
  assert.equal(formatDay('2026-10-07T20:00:00.000Z', 'Asia/Kolkata'), 'Thu, 8 Oct 2026');
  assert.equal(formatDay('2026-10-07T20:00:00.000Z', 'Not/AZone'), 'Wed, 7 Oct 2026', 'bad timezone falls back to UTC');
  assert.equal(formatDay(null, 'UTC'), '');
});
