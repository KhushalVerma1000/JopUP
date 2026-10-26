import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComposeUrl, buildBody, cleanAddresses, isProvider, MAX_URL_LENGTH, DEFAULT_PROVIDER } from './composeLinks.js';

const fields = { to: ['a@x.com', 'b@y.com'], cc: ['c@x.com'], subject: 'Lineup & Interview: 5 Nov', body: 'Hi A,\n\nRegards' };

test('gmail: base, param names, comma-joined recipients, encoded subject and body', () => {
  const { url, truncated } = buildComposeUrl('gmail', fields);
  assert.equal(truncated, false);
  assert.ok(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1&'));
  assert.ok(url.includes('to=a@x.com,b@y.com'));
  assert.ok(url.includes('cc=c@x.com'));
  assert.ok(url.includes('su=Lineup%20%26%20Interview%3A%205%20Nov'));
  assert.ok(url.includes('body=Hi%20A%2C%0A%0ARegards'));
});

test('outlook work and personal use their own hosts and "subject"', () => {
  const work = buildComposeUrl('outlook_work', fields).url;
  const personal = buildComposeUrl('outlook_personal', fields).url;
  assert.ok(work.startsWith('https://outlook.office.com/mail/deeplink/compose?to=a@x.com,b@y.com'));
  assert.ok(personal.startsWith('https://outlook.live.com/mail/0/deeplink/compose?to=a@x.com,b@y.com'));
  assert.ok(work.includes('&subject=Lineup'));
});

test('mailto: address list, params after ?, CRLF line breaks', () => {
  const { url } = buildComposeUrl('mailto', fields);
  assert.ok(url.startsWith('mailto:a@x.com,b@y.com?cc=c@x.com&subject='));
  assert.ok(url.includes('body=Hi%20A%2C%0D%0A%0D%0ARegards'));
});

test('empty cc and bcc are left out entirely', () => {
  const url = buildComposeUrl('gmail', { to: ['a@x.com'], cc: [], bcc: [''], subject: 'S', body: '' }).url;
  assert.ok(!url.includes('cc='));
  assert.ok(!url.includes('bcc='));
  assert.ok(!url.includes('body='));
  assert.equal(buildComposeUrl('mailto', { to: ['a@x.com'] }).url, 'mailto:a@x.com');
});

test('no fields at all still gives a valid compose link', () => {
  assert.equal(buildComposeUrl('gmail', {}).url, 'https://mail.google.com/mail/?view=cm&fs=1');
});

test('special characters and non-ASCII are percent-encoded', () => {
  const { url } = buildComposeUrl('gmail', { to: ['a@x.com'], subject: 'Résumé #1 + "quote" ?=&', body: '' });
  assert.ok(url.includes('su=R%C3%A9sum%C3%A9%20%231%20%2B%20%22quote%22%20%3F%3D%26'));
});

test('addresses are trimmed and de-duplicated case-insensitively; objects accepted', () => {
  assert.deepEqual(cleanAddresses([' A@x.com ', 'a@X.com', { email: 'b@y.com' }, '', null]), ['A@x.com', 'b@y.com']);
});

test('long body is truncated with an ellipsis and the URL fits', () => {
  const body = 'Hello there. '.repeat(400);
  const { url, truncated, tooLong } = buildComposeUrl('gmail', { to: ['a@x.com'], subject: 'S', body });
  assert.equal(truncated, true);
  assert.equal(tooLong, false);
  assert.ok(url.length <= MAX_URL_LENGTH);
  assert.ok(url.endsWith(encodeURIComponent('…')));
});

test('recipients and subject are never cut; an impossible URL is flagged tooLong', () => {
  const to = Array.from({ length: 200 }, (_, i) => `person${i}@example-client.com`);
  const { url, truncated, tooLong } = buildComposeUrl('gmail', { to, subject: 'S', body: 'Hi' });
  assert.equal(truncated, true);
  assert.equal(tooLong, true);
  assert.ok(url.includes('person199@example-client.com'));
  assert.ok(!url.includes('body='));
});

test('unknown provider falls back to the default', () => {
  assert.ok(buildComposeUrl('yahoo', { to: ['a@x.com'] }).url.startsWith('https://mail.google.com/'));
  assert.equal(isProvider('yahoo'), false);
  assert.equal(isProvider(DEFAULT_PROVIDER), true);
});

test('buildBody: greeting by recipient count, sign-off, blank gap for the table', () => {
  assert.equal(buildBody({ recipientNames: ['Rahul Sharma'], senderName: 'Asha Rao' }), 'Hi Rahul,\n\n\n\nRegards,\nAsha Rao');
  assert.ok(buildBody({ recipientNames: ['Rahul S', 'Priya K'] }).startsWith('Hi Rahul and Priya,'));
  assert.ok(buildBody({ recipientNames: ['A', 'B', 'C'] }).startsWith('Hi all,'));
  assert.equal(buildBody(), 'Hello,\n\n\n\nRegards,');
});
