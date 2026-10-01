const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

function loadFresh() {
  for (const k of Object.keys(require.cache)) if (k.includes('services/email')) delete require.cache[k];
  return require('../src/services/email');
}

test('defaults to the console provider when no Resend key is set', () => {
  delete process.env.EMAIL_PROVIDER;
  delete process.env.RESEND_API_KEY;
  assert.equal(loadFresh().resolveProviderName(), 'console');
});

test('uses resend when RESEND_API_KEY is set', () => {
  delete process.env.EMAIL_PROVIDER;
  process.env.RESEND_API_KEY = 're_test';
  assert.equal(loadFresh().resolveProviderName(), 'resend');
  delete process.env.RESEND_API_KEY;
});

test('console provider "sends" without network', async () => {
  process.env.EMAIL_PROVIDER = 'console';
  const { sendEmail } = loadFresh();
  const r = await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hello</p>' });
  assert.equal(r.provider, 'console');
  delete process.env.EMAIL_PROVIDER;
});

test('resend provider posts the expected payload and returns the id', async () => {
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'JopUP <no-reply@mail.example.com>';
  const realFetch = global.fetch;
  let captured;
  global.fetch = async (url, opts) => {
    captured = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ id: 'msg_123' }) };
  };
  try {
    const { sendEmail } = loadFresh();
    const r = await sendEmail({ to: 'x@example.com', subject: 'S', html: '<p>Hi <a href="https://a.b">link</a></p>', replyTo: 'me@example.com' });
    assert.equal(r.id, 'msg_123');
    assert.equal(captured.url, 'https://api.resend.com/emails');
    assert.equal(captured.opts.headers.Authorization, 'Bearer re_test');
    assert.deepEqual(captured.body.to, ['x@example.com']);
    assert.equal(captured.body.from, 'JopUP <no-reply@mail.example.com>');
    assert.equal(captured.body.reply_to, 'me@example.com');
    assert.match(captured.body.text, /link \(https:\/\/a\.b\)/);
  } finally {
    global.fetch = realFetch;
    delete process.env.EMAIL_PROVIDER; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  }
});

test('resend provider surfaces API errors', async () => {
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 're_test';
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ message: 'domain not verified' }) });
  try {
    const { sendEmail } = loadFresh();
    await assert.rejects(() => sendEmail({ to: 'x@example.com', subject: 'S', html: '<p>x</p>' }), /Resend 403: domain not verified/);
  } finally {
    global.fetch = realFetch;
    delete process.env.EMAIL_PROVIDER; delete process.env.RESEND_API_KEY;
  }
});

test('invitation template escapes input and builds the accept link', () => {
  process.env.APP_URL = 'https://app.example.com/';
  const { invitationEmail } = require('../src/services/email/templates/invitation');
  const { subject, html } = invitationEmail({
    orgName: 'Acme <b>Staffing</b>', inviterName: 'Priya', roleName: 'hr', teamName: 'Team A',
    token: 'abc123', expiresAt: new Date('2026-10-08'),
  });
  assert.match(subject, /Acme/);
  assert.ok(!html.includes('<b>Staffing</b>'));
  assert.ok(html.includes('https://app.example.com/accept-invite?token=abc123'));
  assert.ok(html.includes('HR'));
  delete process.env.APP_URL;
});
