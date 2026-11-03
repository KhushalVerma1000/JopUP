/**
 * Header recognition: which column is the phone, the client, the lineup date…
 *
 * A header alone is not trusted. Its score is blended with how well the
 * column's values fit the field (a "Contact" column full of names is not a
 * phone), and unlabeled columns are recognised from their values alone.
 */
const { parsePhoneCell, cleanEmail, looksLikeDate, isBlank } = require('./normalize');
const { interpretStatus } = require('./statusMap');

// Order matters: more specific rules first. Each regex runs on the header
// lower-cased with punctuation turned into single spaces.
const RULES = [
  ['lineupDate',    /\b(line ?up|lined up|lu) ?(date|dt|on)\b|\bdate (of )?(line ?up|lu)\b|\bscheduled (date|for)\b/, 1],
  ['interviewDate', /\b(interview|iv|walk ?in) ?(date|dt|on|schedule)\b|\bdate (of )?(interview|walk ?in)\b|\binterview (day|slot)\b/, 1],
  ['joiningDate',   /\b(doj|joining date|date of joining|joined on|join date|joining dt)\b/, 1],
  ['altPhone',      /\b(alt|alternate|alternative|secondary|other|2nd|second|whatsapp) ?(contact|phone|mobile|number|no)\b/, 1],
  ['phone',         /^(phone|mobile|contact|cell|tel|telephone|mob|ph)( ?(no|number|num|nos|details|detail))?$|\b(phone|mobile|contact|cell|mob) ?(no|number|num)\b|^whatsapp( no| number)?$/, 1],
  ['email',         /\be ?mail( ?(id|address|add))?\b|^mail$/, 1],
  ['clientLocation',/\b(job|work|posting|hiring|store|branch|outlet|site|process|plant) ?(location|city|place)\b|^(store|branch|outlet|site)( name)?$|\bposted (at|in)\b/, 0.95],
  ['location',      /\b(current|candidate|present|home|native|residence) ?(location|city|address|place)\b|^(location|city|place|loc|current loc)$/, 0.85],
  ['client',        /^(client|company|customer|account|employer|organi[sz]ation|client name|company name|client company|principal)$|\b(client|hiring company) ?name\b/, 1],
  ['designation',   /^(position|designation|role|profile|job title|job role|opening|requirement|vacancy|post|job|applied for|position applied|position name|role applied)$|\b(position|designation|job) ?(title|name|applied)\b/, 1],
  ['status',        /^(status|stage|current status|candidate status|final status|result|outcome|disposition|feedback status|selection status)$/, 1],
  ['remarks',       /^(remarks?|comments?|notes?|feedback|reason|rejection reason|hr remarks|recruiter remarks|reason for rejection)$/, 1],
  ['experience',    /^(exp|experience|total exp|total experience|exp in yrs|experience in years|yrs of exp|work exp|years of experience|tot exp|relevant exp)( ?(yrs|years|in years))?$/, 1],
  ['currentCtc',    /\b(current|present|last|existing) ?(ctc|salary|package)\b|^(ctc|c ctc|cctc|current ctc)$/, 1],
  ['expectedCtc',   /\b(expected|exp|ectc|desired) ?(ctc|salary|package)\b|^(ectc|e ctc)$/, 1],
  ['noticePeriod',  /\bnotice( period)?\b|^np$|\bserving notice\b/, 1],
  ['source',        /^(source|sourced from|source of hire|channel|portal|source portal)$/, 1],
  ['recruiter',     /^(recruiter|hr|hr name|recruiter name|sourced by|owner|spoc|handled by|assigned to|executive|recruiter hr|consultant|coordinator|tagged by|bd)$/, 1],
  ['skills',        /^(skills?|key skills|primary skills?|skill set|technologies)$/, 1],
  ['qualification', /^(qualification|education|degree|highest qualification)$/, 1],
  ['currentEmployer', /^(current company|current employer|present company|current organi[sz]ation|company name current)$/, 1],
  ['resumeLink',    /^(resume|cv|resume link|cv link|resume url|resume file)$/, 1],
  ['firstName',     /^(first name|fname|given name|first)$/, 1],
  ['lastName',      /^(last name|lname|surname|family name|last)$/, 1],
  ['candidateName', /^(name|candidate|candidate name|full name|applicant|applicant name|name of candidate|name of the candidate|cand name|candidate full name)$|\bcandidate\b.*\bname\b/, 1],
  ['srNo',          /^(s ?no|sr ?no|sl ?no|serial( no)?|#|no|sr|sl|s n|id|sr number)$/, 1],
  ['genericDate',   /^(date|dt|day|on)$/, 0.7],
];

const normHeader = (h) => String(h === null || h === undefined ? '' : h).toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

/** Header text -> { field, score } or null. */
function matchHeader(raw) {
  const h = normHeader(raw);
  if (!h) return null;
  for (const [field, re, score] of RULES) if (re.test(h)) return { field, score };
  return null;
}

const ratio = (values, fn) => {
  const filled = values.filter((v) => !isBlank(v));
  if (!filled.length) return 0;
  return filled.filter(fn).length / filled.length;
};

/** How well do these values look like the field? 0..1, or null when we can't judge. */
function contentFit(field, values, ctx = {}) {
  switch (field) {
    case 'phone': case 'altPhone':
      return ratio(values, (v) => parsePhoneCell(v, ctx.defaultCountry).phone && /\d{8,}/.test(String(typeof v === 'number' ? Math.round(v) : v).replace(/\D/g, '')));
    case 'email': return ratio(values, (v) => cleanEmail(v).valid === true);
    case 'lineupDate': case 'interviewDate': case 'joiningDate': case 'genericDate':
      return ratio(values, (v) => looksLikeDate(v) || (typeof v === 'number' && v > 30000 && v < 70000));
    case 'status': return ratio(values, (v) => interpretStatus(String(v)).matched !== null);
    case 'experience': return ratio(values, (v) => /^\d|fresh/i.test(String(v)));
    case 'candidateName': case 'firstName': case 'lastName':
      return ratio(values, (v) => typeof v === 'string' && /[A-Za-z]{2}/.test(v) && !/@|\d{6,}/.test(v));
    default: return null;
  }
}

/** Recognise an unlabeled column from its values alone. */
function sniffColumn(values, ctx) {
  const filled = values.filter((v) => !isBlank(v));
  if (filled.length < 3) return null;
  if (contentFit('email', values) >= 0.7) return { field: 'email', score: 0.6 };
  if (contentFit('phone', values, ctx) >= 0.8) return { field: 'phone', score: 0.6 };
  if (contentFit('genericDate', values) >= 0.8) return { field: 'genericDate', score: 0.5 };
  if (contentFit('status', values) >= 0.6) return { field: 'status', score: 0.55 };
  return null;
}

module.exports = { RULES, matchHeader, contentFit, sniffColumn, normHeader };
