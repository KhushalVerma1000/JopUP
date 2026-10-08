/**
 * wa.me link for a candidate. Needs the full international number: prefer the
 * stored E.164 value (country already resolved); fall back to the typed phone
 * only if it already carries a country code ("+91…"). A bare local number is
 * ambiguous, so we show no WhatsApp action rather than message a stranger.
 *
 * `text` pre-fills the chat box; the HR still has to press send.
 */
export function whatsappUrl(e164, typedPhone, text) {
  const raw = e164 || (typeof typedPhone === 'string' && typedPhone.trim().startsWith('+') ? typedPhone : '');
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export const whatsappProps = { target: '_blank', rel: 'noopener noreferrer' };
