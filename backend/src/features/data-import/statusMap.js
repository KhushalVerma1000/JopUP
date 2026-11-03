/**
 * Free-text status ("Reached", "Not reachable", "L2 cleared") -> pipeline position.
 *
 * Rules are checked in order and the order is the logic: negatives ("not
 * selected") must win over the positive word they contain ("selected").
 * Anything unrecognised comes back with matched = null, and the wizard asks HR
 * once; their answer is stored per org and passed back in as `overrides`.
 *
 * Result shape:
 *   stageKey  workflow stage the candidate is at (applied|screening|lineup|turnup|interview|offer|joined) or null
 *   status    candidate_tracker.status: active | placed | rejected | withdrawn | on_hold
 *   reason    for rejected / withdrawn: the sheet's own words
 *   matched   'rule' | 'override' | null
 */
const norm = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();

const RULES = [
  // ── ended without a placement ─────────────────────────────────────────────
  [/\bno ?show\b|did ?n.?t (turn|come|show|attend|appear)|\babsent\b|not (turned|attended|appeared|came)/, { stageKey: 'lineup', status: 'rejected', reasonFrom: 'No show' }],
  [/not reachable|unreachable|not responding|no response|not picking|switched off|\bnr\b|\bnrc\b|ringing|not answering|number (not|invalid)|wrong number/, { stageKey: 'screening', status: 'rejected', reasonFrom: 'Not reachable' }],
  [/not interested|\bni\b|declined|decline|refused|not willing|denied|withdr[ae]w|dropped out|backed out|not looking|no longer interested|\bdrop\b|\bdropped\b/, { stageKey: null, status: 'withdrawn', reasonFrom: true }],
  [/not (selected|suitable|fit|eligible|shortlisted|cleared|qualified|considered|a fit)|reject|\brej\b|screen ?out|not okay|not ok\b|\bunfit\b|failed|\bfail\b|blacklist/, { stageKey: null, status: 'rejected', reasonFrom: true }],
  // ── on hold ───────────────────────────────────────────────────────────────
  [/\bon hold\b|\bhold\b|\bpending\b|call back|callback|later|postponed|re ?schedule|follow ?up|\bwip\b|in process/, { stageKey: null, status: 'on_hold', reasonFrom: false }],
  // ── forward progress (furthest first) ────────────────────────────────────
  [/\bjoined\b|\bjoin\b|onboard|\bdoj\b|joining done|reported to work|\bplaced\b/, { stageKey: 'joined', status: 'placed' }],
  // a numbered round is still the interview stage, even when the word "cleared" follows it
  [/\bl[1-4]\b|\bround ?[1-4]\b|\b[1-4](st|nd|rd|th) round\b/, { stageKey: 'interview', status: 'active' }],
  [/offer|\bselected\b|\bselect\b|shortlisted|\bcleared\b|\bapproved\b|final round cleared|\bok for client\b|\bhired\b|accepted/, { stageKey: 'offer', status: 'active' }],
  [/interview|\bl[1-4]\b|round|\btechnical\b|\bhr round\b|discussion|\bf2f\b|face to face|assessment|\btest\b|\bwalk ?in\b/, { stageKey: 'interview', status: 'active' }],
  [/reached|turn ?up|turned up|attended|appeared|\bpresent\b|came|\breport(ed)?\b|arrived|at (the )?(site|office|store|venue)/, { stageKey: 'turnup', status: 'active' }],
  [/line ?up|lined up|\bscheduled\b|confirmed|\bconfirm\b|will (come|attend)|\bcoming\b|\binvited\b|\bshared\b|submitted|sent to client|profile shared|cv shared|forwarded/, { stageKey: 'lineup', status: 'active' }],
  [/screen|call (done|completed)|\bcontacted\b|discussed|talked|spoke|interested|\bcalled\b|connected|\bhot\b|\bwarm\b/, { stageKey: 'screening', status: 'active' }],
  [/^(new|applied|sourced|fresh|open|na|n a|received)$|\bapplied\b|\bsourced\b|\bnew lead\b|\bto be (called|contacted)\b/, { stageKey: 'applied', status: 'active' }],
];

const clean = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * @param {string} text   the status cell
 * @param {Object<string,object>} overrides  { [normalisedText]: { stageKey, status, reason? } } from HR's earlier answers
 */
function interpretStatus(text, overrides = {}) {
  const key = norm(text);
  if (!key) return { stageKey: null, status: null, reason: null, matched: null, key };
  if (overrides[key]) {
    const o = overrides[key];
    return { stageKey: o.stageKey || null, status: o.status || 'active', reason: o.reason || null, matched: 'override', key };
  }
  for (const [re, out] of RULES) {
    if (!re.test(key)) continue;
    let reason = null;
    if (out.reasonFrom === true) reason = clean(text);
    else if (typeof out.reasonFrom === 'string') reason = clean(text).length > 3 && !/^(no ?show|nr|nrc)$/i.test(clean(text)) ? clean(text) : out.reasonFrom;
    return { stageKey: out.stageKey, status: out.status, reason, matched: 'rule', key };
  }
  return { stageKey: null, status: null, reason: null, matched: null, key };
}

module.exports = { interpretStatus, norm };
