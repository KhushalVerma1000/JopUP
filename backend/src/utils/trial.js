/**
 * Trial rules. Pure helpers, no DB, so they can be unit tested.
 *
 *   standard  30 days, every self-serve signup
 *   extended  90 days, only companies a platform admin has selected
 *
 * The length is NOT taken from the request and NOT from plan.trial_days, so a
 * client cannot ask for a longer trial and a plan edit cannot change it.
 */
const DAY_MS = 86400000;
const STANDARD_TRIAL_DAYS = 30;
const EXTENDED_TRIAL_DAYS = 90;

// Every self-serve signup starts here. The request cannot pick a plan: the
// premium tiers are tasted through the time-boxed preview (see entitlements.js
// previewState) or granted by a platform admin after an email request.
const DEFAULT_TRIAL_PLAN_SLUG = 'starter';

// Domains nobody owns: a "@gmail.com" selection would hand 90 days to everyone.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com',
  'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com',
  'gmx.com', 'mail.com', 'yandex.com',
]);

/**
 * Normalise what an admin typed into a stored match key.
 * "HR@Acme.com" -> "hr@acme.com"; "acme.com" or "@acme.com" -> "@acme.com".
 * @returns {{ok:true, match:string, kind:'email'|'domain'} | {ok:false, error:string}}
 */
function normalizeSelection(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return { ok: false, error: 'Enter an email address or a company domain.' };
  if (/\s/.test(v)) return { ok: false, error: 'No spaces allowed.' };
  if (v.includes('@') && !v.startsWith('@')) {
    if (!/^[^@]+@[^@.]+(\.[^@.]+)+$/.test(v)) return { ok: false, error: 'That is not a valid email address.' };
    return { ok: true, match: v, kind: 'email' };
  }
  const domain = v.replace(/^@/, '');
  if (!/^[^@.]+(\.[^@.]+)+$/.test(domain)) return { ok: false, error: 'That is not a valid domain (example: acme.com).' };
  if (FREE_MAIL_DOMAINS.has(domain)) {
    return { ok: false, error: `${domain} is a public mail provider. Select the person's exact email address instead.` };
  }
  return { ok: true, match: `@${domain}`, kind: 'domain' };
}

/** Keys that could match a signup email: the exact address, then its domain. */
function matchKeys(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return [];
  const domain = e.slice(at);
  return FREE_MAIL_DOMAINS.has(domain.slice(1)) ? [e] : [e, domain];
}

/** @returns {{tier:'standard'|'extended', days:number}} */
function trialFor(selected) {
  return selected
    ? { tier: 'extended', days: EXTENDED_TRIAL_DAYS }
    : { tier: 'standard', days: STANDARD_TRIAL_DAYS };
}

/**
 * End date when an admin grants the extended trial to an existing org.
 * from 'signup' = 90 days counted from creation (the same as if it had been
 * selected up front); 'today' = 90 days from now.
 * @returns {Date}
 */
function extendedEnd(createdAt, from = 'signup', now = new Date()) {
  const base = from === 'today' ? now : new Date(createdAt);
  return new Date(base.getTime() + EXTENDED_TRIAL_DAYS * DAY_MS);
}

/** End date when reverting to the standard trial, counted from signup. */
function standardEnd(createdAt) {
  return new Date(new Date(createdAt).getTime() + STANDARD_TRIAL_DAYS * DAY_MS);
}

/**
 * Credits a new trial workspace starts with. A plan may set
 * limits.trial_credits (a small taste); otherwise it gets the plan allowance.
 */
function trialCreditsFor(plan) {
  const v = plan && plan.limits ? Number(plan.limits.trial_credits) : NaN;
  if (Number.isFinite(v) && v >= 0) return Math.floor(v);
  return Math.max(0, Math.floor(Number(plan && plan.creditAllowance) || 0));
}

module.exports = {
  STANDARD_TRIAL_DAYS, EXTENDED_TRIAL_DAYS, DEFAULT_TRIAL_PLAN_SLUG, FREE_MAIL_DOMAINS, trialCreditsFor,
  normalizeSelection, matchKeys, trialFor, extendedEnd, standardEnd,
};
