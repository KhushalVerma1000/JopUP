/**
 * Resend provider — plain fetch against the REST API (Node 18+), so no new
 * dependency is needed. Docs: https://resend.com/docs/api-reference/emails/send-email
 */
const RESEND_URL = 'https://api.resend.com/emails';

async function send({ from, to, subject, html, text, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${body?.message || body?.name || 'request failed'}`);
  }
  return { id: body.id || null };
}

module.exports = { send };
