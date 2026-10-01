/**
 * Email service — the single entry point for sending mail from the backend.
 *
 * Routes/services call sendEmail(); they never talk to a provider directly,
 * so swapping providers (or adding Gmail/Microsoft per-user sending later)
 * means adding a provider module here, not touching feature code.
 *
 * Providers:
 *   resend  — Resend REST API (needs RESEND_API_KEY + EMAIL_FROM)
 *   console — logs the email instead of sending (local dev / tests)
 *
 * Selection: EMAIL_PROVIDER if set, otherwise "resend" when RESEND_API_KEY
 * exists, otherwise "console".
 */
const resend = require('./providers/resend');
const consoleProvider = require('./providers/console');

const providers = { resend, console: consoleProvider };

function resolveProviderName() {
  const explicit = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  if (explicit) return explicit;
  return process.env.RESEND_API_KEY ? 'resend' : 'console';
}

/**
 * @param {object} msg
 * @param {string|string[]} msg.to
 * @param {string} msg.subject
 * @param {string} msg.html
 * @param {string} [msg.text]     plain-text alternative (generated from html if omitted)
 * @param {string} [msg.from]     defaults to EMAIL_FROM
 * @param {string} [msg.replyTo]
 * @returns {Promise<{ provider: string, id: string|null }>}
 * @throws if the provider rejects the message — callers decide whether that is fatal
 */
async function sendEmail({ to, subject, html, text, from, replyTo }) {
  const name = resolveProviderName();
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown EMAIL_PROVIDER '${name}'`);

  const payload = {
    from: from || process.env.EMAIL_FROM || 'JopUP <onboarding@resend.dev>',
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text: text || htmlToText(html),
    replyTo: replyTo || process.env.EMAIL_REPLY_TO || undefined,
  };

  const result = await provider.send(payload);
  return { provider: name, id: result?.id || null };
}

function htmlToText(html = '') {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>|<\/p>|<\/h\d>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { sendEmail, resolveProviderName };
