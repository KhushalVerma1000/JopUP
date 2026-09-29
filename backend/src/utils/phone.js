/**
 * Phone normalization — global, not India-only.
 *
 * Used everywhere a candidate's phone is written (candidates.service.js,
 * trackers.service.js's inline quick-add) so the duplicate-detection key
 * (ADR-2: candidate.phoneNormalized) is computed exactly once, the same
 * way, regardless of entry path.
 *
 * ADR-2 decision: dedup on phone alone, never phone+name. A phone number
 * is ambiguous without knowing which country it was entered in — the same
 * digits mean a different number in every country — so phoneCountry is
 * always required alongside phone. There is deliberately no fallback to
 * "assume India" or any other country: this platform is global, and a
 * company may work with candidates or clients anywhere.
 */

const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Normalizes a raw phone string against an ISO 3166-1 alpha-2 country
 * code into E.164 form (e.g. "+919876543210").
 *
 * Returns null when phone or country is missing, or when the number
 * doesn't parse as valid for that country — callers treat null as "skip
 * dedup for this record", never as an error. A candidate can be created
 * with an unparseable phone (e.g. a landline extension, a partial number
 * from a resume); dedup just won't catch it.
 */
function normalizePhone(rawPhone, countryCode) {
  if (!rawPhone || !countryCode) return null;

  try {
    const parsed = parsePhoneNumberFromString(rawPhone, countryCode.toUpperCase());
    if (!parsed || !parsed.isValid()) return null;
    return parsed.number; // E.164, e.g. "+919876543210"
  } catch {
    return null;
  }
}

module.exports = { normalizePhone };
