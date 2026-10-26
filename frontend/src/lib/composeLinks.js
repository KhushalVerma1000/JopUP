/**
 * Browser compose links: open a prefilled "new mail" window in the user's own
 * mail account instead of sending through the platform's mail provider.
 *
 * Pure functions, no DOM access, so they are unit-tested under `node --test`.
 * The formatted table can't travel in a URL (too long, no HTML), so the link
 * carries To, Cc, Subject and a SHORT plain-text body; the table goes through
 * the clipboard (see richCopy.js) and the user pastes it.
 */

export const PROVIDERS = {
  gmail: { label: 'Gmail', short: 'Gmail' },
  outlook_work: { label: 'Outlook (work or school)', short: 'Outlook' },
  outlook_personal: { label: 'Outlook (personal)', short: 'Outlook' },
  mailto: { label: 'Desktop mail app', short: 'Mail app' },
};

export const DEFAULT_PROVIDER = 'gmail';

// Browsers and servers cope with longer URLs, but 2,000 is the safe common limit.
export const MAX_URL_LENGTH = 1900;

export const isProvider = (value) => typeof value === 'string' && Object.hasOwn(PROVIDERS, value);

const SPECS = {
  gmail: { base: 'https://mail.google.com/mail/?view=cm&fs=1', first: '&', keys: { to: 'to', cc: 'cc', bcc: 'bcc', subject: 'su', body: 'body' } },
  outlook_work: { base: 'https://outlook.office.com/mail/deeplink/compose', first: '?', keys: { to: 'to', cc: 'cc', bcc: 'bcc', subject: 'subject', body: 'body' } },
  outlook_personal: { base: 'https://outlook.live.com/mail/0/deeplink/compose', first: '?', keys: { to: 'to', cc: 'cc', bcc: 'bcc', subject: 'subject', body: 'body' } },
};

const encode = (text) => encodeURIComponent(text);
// "@" is legal in a query value and reads better; everything else is encoded.
const encodeAddress = (address) => encode(address).replace(/%40/g, '@');

/** Trim, drop blanks, drop case-insensitive duplicates. Accepts strings or { email }. */
export function cleanAddresses(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const address = String((item && typeof item === 'object' ? item.email : item) ?? '').trim();
    const key = address.toLowerCase();
    if (!address || seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

function assemble(provider, { to, cc, bcc, subject, body }) {
  if (provider === 'mailto') {
    const params = [];
    if (cc.length) params.push(`cc=${cc.map(encodeAddress).join(',')}`);
    if (bcc.length) params.push(`bcc=${bcc.map(encodeAddress).join(',')}`);
    if (subject) params.push(`subject=${encode(subject)}`);
    // mailto: bodies use CRLF line breaks.
    if (body) params.push(`body=${encode(body.replace(/\r?\n/g, '\r\n'))}`);
    return `mailto:${to.map(encodeAddress).join(',')}${params.length ? `?${params.join('&')}` : ''}`;
  }
  const { base, first, keys } = SPECS[provider];
  const params = [];
  if (to.length) params.push(`${keys.to}=${to.map(encodeAddress).join(',')}`);
  if (cc.length) params.push(`${keys.cc}=${cc.map(encodeAddress).join(',')}`);
  if (bcc.length) params.push(`${keys.bcc}=${bcc.map(encodeAddress).join(',')}`);
  if (subject) params.push(`${keys.subject}=${encode(subject)}`);
  if (body) params.push(`${keys.body}=${encode(body)}`);
  return params.length ? `${base}${first}${params.join('&')}` : base;
}

/**
 * Build the compose URL for a provider.
 *
 * Returns { url, truncated, tooLong }:
 *  - truncated: the body was shortened (ending in "…") so the URL stays under maxLength
 *  - tooLong:   even with no body the URL is over maxLength (a huge recipient list or
 *               subject); the link is still returned, but some browsers may refuse it
 *
 * An unknown provider falls back to the default so a stale saved preference never breaks the button.
 */
export function buildComposeUrl(provider, fields = {}, maxLength = MAX_URL_LENGTH) {
  const p = isProvider(provider) ? provider : DEFAULT_PROVIDER;
  const parts = {
    to: cleanAddresses(fields.to),
    cc: cleanAddresses(fields.cc),
    bcc: cleanAddresses(fields.bcc),
    subject: String(fields.subject ?? '').trim(),
    body: String(fields.body ?? ''),
  };

  let url = assemble(p, parts);
  if (url.length <= maxLength) return { url, truncated: false, tooLong: false };

  // Shrink the body until the URL fits; the subject and recipients are never cut.
  let body = parts.body;
  while (body.length > 0 && url.length > maxLength) {
    const cut = Math.max(1, Math.floor(body.length * 0.1));
    body = body.slice(0, body.length - cut).trimEnd();
    url = assemble(p, { ...parts, body: body ? `${body}…` : '' });
  }
  return { url, truncated: true, tooLong: url.length > maxLength };
}

const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || '';

/**
 * The short plain-text body that travels in the link: greeting and sign-off only.
 * The blank lines between them are where the pasted table goes.
 */
export function buildBody({ recipientNames = [], senderName = '' } = {}) {
  const names = [...new Set(recipientNames.map(firstName).filter(Boolean))];
  const greeting = names.length === 0 ? 'Hello,' : names.length === 1 ? `Hi ${names[0]},` : names.length === 2 ? `Hi ${names[0]} and ${names[1]},` : 'Hi all,';
  const sender = String(senderName || '').trim();
  return `${greeting}\n\n\n\nRegards,${sender ? `\n${sender}` : ''}`;
}
