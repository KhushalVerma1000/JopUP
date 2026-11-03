/**
 * Value normalisers for spreadsheet imports. Pure functions, no database.
 *
 * Dates are returned as date-only strings ("2026-10-12"): a sheet cell says
 * "12 Oct", not a moment in time, so the org's timezone is applied once, at
 * commit time, instead of drifting here.
 */
const { parsePhoneNumberFromString } = require('libphonenumber-js');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const monthOf = (w) => MONTHS[w.slice(0, 4).toLowerCase()] || MONTHS[w.slice(0, 3).toLowerCase()] || null;
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function validYmd(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const fullYear = (y) => (y < 100 ? (y >= 70 ? 1900 + y : 2000 + y) : y);

/** Look through every date-like string in a column and decide day-first vs month-first. */
function detectDateOrder(values) {
  let dmy = 0; let mdy = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = v.trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
    if (!m) continue;
    const a = Number(m[1]); const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy += 1;
    else if (b > 12 && a <= 12) mdy += 1;
  }
  if (dmy && !mdy) return { order: 'dmy', certain: true };
  if (mdy && !dmy) return { order: 'mdy', certain: true };
  if (dmy && mdy) return { order: 'mixed', certain: false };
  return { order: 'dmy', certain: false }; // nothing settles it: assume day-first, say so
}

/**
 * -> { date: 'YYYY-MM-DD' | null, ambiguous: boolean }
 * Accepts Date objects, Excel serial numbers, and the usual HR spellings.
 */
function parseDate(value, { order = 'dmy', now = new Date() } = {}) {
  if (value === null || value === undefined || value === '') return { date: null, ambiguous: false };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { date: null, ambiguous: false };
    return { date: iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()), ambiguous: false };
  }
  if (typeof value === 'number') {
    if (value >= 20000 && value <= 80000) { // Excel serial day count
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
      return { date: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), ambiguous: false };
    }
    return { date: null, ambiguous: false };
  }
  const s = String(value).trim().replace(/(\d)(st|nd|rd|th)\b/i, '$1');
  if (!s) return { date: null, ambiguous: false };

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // 2026-10-12
  if (m) return validYmd(+m[1], +m[2], +m[3]) ? { date: iso(+m[1], +m[2], +m[3]), ambiguous: false } : { date: null, ambiguous: false };

  m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})\.?[\s\-/.,]*(\d{2,4})?$/); // 12 Oct 2026, 12-Oct-26, 12 Oct
  if (m && monthOf(m[2])) {
    const y = m[3] ? fullYear(+m[3]) : now.getUTCFullYear();
    return validYmd(y, monthOf(m[2]), +m[1]) ? { date: iso(y, monthOf(m[2]), +m[1]), ambiguous: false } : { date: null, ambiguous: false };
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{2,4})?$/); // Oct 12, 2026
  if (m && monthOf(m[1])) {
    const y = m[3] ? fullYear(+m[3]) : now.getUTCFullYear();
    return validYmd(y, monthOf(m[1]), +m[2]) ? { date: iso(y, monthOf(m[1]), +m[2]), ambiguous: false } : { date: null, ambiguous: false };
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/); // 12/10/2026
  if (m) {
    const a = +m[1]; const b = +m[2]; const y = fullYear(+m[3]);
    const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    if (validYmd(y, mo, d)) return { date: iso(y, mo, d), ambiguous: a <= 12 && b <= 12 && a !== b };
    // the other reading may still be valid (e.g. 13/10 under mdy)
    const [d2, mo2] = order === 'mdy' ? [a, b] : [b, a];
    return validYmd(y, mo2, d2) ? { date: iso(y, mo2, d2), ambiguous: false } : { date: null, ambiguous: false };
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})$/); // 12/10 (no year): this year
  if (m) {
    const a = +m[1]; const b = +m[2]; const y = now.getUTCFullYear();
    const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    return validYmd(y, mo, d) ? { date: iso(y, mo, d), ambiguous: a <= 12 && b <= 12 && a !== b } : { date: null, ambiguous: false };
  }
  return { date: null, ambiguous: false };
}

/** Does this value look like a date at all (used to sniff unlabeled columns)? */
function looksLikeDate(v) {
  if (v instanceof Date) return true;
  if (typeof v === 'number') return false; // bare numbers are too ambiguous to sniff
  return parseDate(v).date !== null;
}

const TITLES = /^(mr|mrs|ms|miss|dr|shri|smt|sri)\.?$/i;

/** "MR. RAHUL KUMAR sharma" -> { firstName: 'Rahul Kumar', lastName: 'Sharma' } */
function splitName(raw) {
  if (raw === null || raw === undefined) return { firstName: null, lastName: null };
  let parts = String(raw).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  while (parts.length > 1 && TITLES.test(parts[0])) parts.shift();
  parts = parts.filter((p) => !/^\d+$/.test(p));
  if (!parts.length) return { firstName: null, lastName: null };
  const cased = parts.map((p) => (p === p.toUpperCase() || p === p.toLowerCase())
    ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p);
  if (cased.length === 1) return { firstName: cased[0], lastName: null };
  return { firstName: cased.slice(0, -1).join(' '), lastName: cased[cased.length - 1] };
}

/** "5y 8m", "5.5 yrs", "3 years 2 months", "fresher", "2+" -> years (number) or null */
function parseExperience(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw >= 0 && raw <= 60 ? Math.round(raw * 10) / 10 : null;
  const s = String(raw).toLowerCase().trim();
  if (/fresher|\bfresh\b|^nil$|^na$|^n\/a$/.test(s)) return /fresh/.test(s) ? 0 : null;
  const ym = s.match(/(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years)\b[^\d]*(?:(\d+)\s*(?:m|mo|mos|month|months)\b)?/);
  if (ym) return Math.round((Number(ym[1]) + (ym[2] ? Number(ym[2]) / 12 : 0)) * 10) / 10;
  const mo = s.match(/^(\d+)\s*(?:m|mo|mos|month|months)\b/);
  if (mo) return Math.round((Number(mo[1]) / 12) * 10) / 10;
  const n = s.match(/^(\d+(?:\.\d+)?)\s*\+?$/);
  if (n) { const v = Number(n[1]); return v >= 0 && v <= 60 ? v : null; }
  return null;
}

/**
 * Excel hands phones over as numbers (9876543210), floats (9.87654321E9),
 * "98765 43210", "+91-98765-43210", or "98765 43210 / 91234 56789".
 * Numbers with a + prefix carry their own country; bare numbers use the org's
 * default country, and with neither there is nothing to validate against.
 * -> { phone, alt, phoneCountry, phoneNormalized, valid }
 */
function parsePhoneCell(raw, defaultCountry) {
  const empty = { phone: null, alt: null, phoneCountry: null, phoneNormalized: null, valid: null };
  if (raw === null || raw === undefined || raw === '') return empty;
  let s = typeof raw === 'number' ? String(Math.round(raw)) : String(raw).trim();
  s = s.replace(/\.0+$/, '');
  const chunks = s.split(/[\/,;|\n]|\s{2,}|\s+(?:or|and)\s+/i).map((c) => c.trim()).filter((c) => c.replace(/\D/g, '').length >= 6);
  if (!chunks.length) return { ...empty, phone: s || null, valid: false };
  const first = chunks[0];
  const country = defaultCountry ? String(defaultCountry).toUpperCase() : undefined;
  let parsed = null;
  try { parsed = parsePhoneNumberFromString(first, country); } catch { parsed = null; }
  const ok = Boolean(parsed && parsed.isValid());
  return { phone: first, alt: chunks[1] || null, phoneCountry: ok ? (parsed.country || country || null) : (country || null), phoneNormalized: ok ? parsed.number : null, valid: ok };
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
function cleanEmail(raw) {
  if (raw === null || raw === undefined) return { email: null, valid: null };
  const s = String(raw).trim().toLowerCase().replace(/^mailto:/, '').split(/[\s,;]+/)[0] || '';
  if (!s) return { email: null, valid: null };
  return { email: s, valid: EMAIL_RE.test(s) };
}

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const text = (v) => (isBlank(v) ? null : (v instanceof Date ? iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) : String(v).replace(/\s+/g, ' ').trim()));

module.exports = { parseDate, detectDateOrder, looksLikeDate, splitName, parseExperience, parsePhoneCell, cleanEmail, isBlank, text, EMAIL_RE };
