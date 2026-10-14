/**
 * Rule-based field extraction from raw resume text. No network, no per-call
 * cost. Everything here is deterministic so it is easy to unit test.
 *
 * Returns the candidate-shaped fields plus per-field confidence and warnings
 * so the review screen can highlight what a human should double check.
 */
const { parsePhoneNumberFromString, findPhoneNumbersInText } = require('libphonenumber-js');
const { SKILLS, ALIASES } = require('./skills');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%\-]+)/i;
const SECTION_WORDS = /^(resume|r[eé]sum[eé]|curriculum\s+vitae|cv|profile|summary|objective|career\s+objective|contact|contact\s+details|personal\s+(details|information|profile)|about\s+me|skills|education|experience|work\s+experience|declaration)$/i;
const NAME_LABEL_RE = /^\s*(?:full\s+)?name\s*[:\-–]\s*(.+)$/i;
const BAD_NAME_TOKENS = /\b(resume|curriculum|vitae|engineer|developer|manager|analyst|executive|consultant|designer|intern|fresher|objective|summary|profile|address|email|mobile|phone|contact|experience|education|skills|linkedin|github|http|www|accountant|recruiter|officer|associate|specialist|administrator|coordinator|supervisor|trainee|professional|architect|tester|programmer|university|college|institute|school|board|private|limited|ltd|pvt)\b/i;
// Words that can never be part of a person's name. In two-column / OCR'd layouts a
// name line often has the neighbouring column glued on ("Himanshu patel and belief.").
const NAME_STOPWORDS = /^(and|the|of|to|in|at|for|with|is|are|belief|knowledge|nationality|date|place|dob|mob|mobile|phone|email|address|languages?|declaration|signature|hereby|gender|marital|status)$/i;

const MAJOR_CITIES = [
  'Mumbai', 'Delhi', 'New Delhi', 'Bengaluru', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad',
  'Jaipur', 'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Bhopal', 'Patna', 'Vadodara', 'Ghaziabad',
  'Ludhiana', 'Agra', 'Nashik', 'Faridabad', 'Meerut', 'Noida', 'Greater Noida', 'Gurgaon', 'Gurugram',
  'Chandigarh', 'Coimbatore', 'Kochi', 'Thiruvananthapuram', 'Visakhapatnam', 'Vijayawada', 'Mysore', 'Mysuru',
  'Bhubaneswar', 'Dehradun', 'Ranchi', 'Raipur', 'Guwahati', 'Aligarh', 'Varanasi', 'Prayagraj', 'Allahabad',
  'Amritsar', 'Jodhpur', 'Udaipur', 'Rajkot', 'Madurai', 'Mangalore', 'Thane', 'Navi Mumbai',
  'Dubai', 'Abu Dhabi', 'Singapore', 'London', 'New York', 'San Francisco', 'Toronto', 'Sydney',
];
const CITY_RE = new RegExp(`\\b(${MAJOR_CITIES.map(c => c.replace(/\s+/g, '\\s+')).join('|')})\\b(?:\\s*,\\s*([A-Z][A-Za-z ]{2,25}))?`, 'i');

const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, p, c) => p + c.toUpperCase());

function cleanLines(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[\u00a0\u200b]/g, ' ')
    .split('\n')
    .map(l => l.replace(/^[\s•▪●◦·*\-–—|]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractEmail(text) {
  const matches = (text.match(EMAIL_RE) || []).filter(e => !/example\.com|yourname|youremail/i.test(e));
  return matches.length ? matches[0].toLowerCase() : null;
}

function extractLinkedin(text) {
  const m = text.match(LINKEDIN_RE);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

/**
 * Phone: prefers numbers with an explicit +CC (country known for certain);
 * otherwise uses defaultCountry. Never guesses a country (ADR-2) — when
 * there is no +CC and no defaultCountry, phone is returned with a null
 * phoneCountry and a warning so the UI can ask.
 */
function extractPhone(text, defaultCountry) {
  const found = findPhoneNumbersInText(text, defaultCountry || undefined);
  const valid = found.filter(f => f.number && f.number.isValid());
  if (valid.length) {
    // explicit international numbers first, then by order of appearance
    const intl = valid.find(f => /^\s*\+/.test(text.slice(f.startsAt, f.endsAt)) || /^\s*00/.test(text.slice(f.startsAt, f.endsAt)));
    const pick = (intl || valid[0]).number;
    return { phone: pick.formatInternational(), phoneCountry: pick.country || defaultCountry || null, confidence: 'high' };
  }
  // No default country and no +CC: grab the first plausible digit run so HR sees it.
  const m = text.match(/(?<![\d])(\+?\d[\d\s().-]{8,14}\d)(?![\d])/);
  if (m) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13 && !/^(19|20)\d{2}/.test(digits)) {
      return { phone: m[1].trim(), phoneCountry: null, confidence: 'low' };
    }
  }
  return null;
}

const SKILL_PHRASES = new Set([...SKILLS, ...Object.values(ALIASES)].map(x => x.toLowerCase()));

/**
 * Split a line into name-like tokens, tolerating OCR debris ("Z| SURYA PRAKASH a"):
 * stops at a pipe/bullet/comma, drops tokens without letters, and trims 1-2
 * letter junk from both ends (initials like "A." are kept).
 */
function cleanTokens(text) {
  const out = [];
  for (const raw of text.trim().split(/\s+/)) {
    if (raw === '|' || raw === '•' || raw === '·') break;
    const endsComma = /,$/.test(raw);
    const tok = raw.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z.'’-]+$/, '');
    if (/[A-Za-z]/.test(tok)) out.push(tok);
    if (endsComma) break;
  }
  const isNoise = (t) => t.replace(/\./g, '').length < 3 && !/^[A-Z]\.$/.test(t);
  while (out.length > 1 && isNoise(out[0])) out.shift();
  while (out.length > 1 && isNoise(out[out.length - 1])) out.pop();
  return out;
}

function nameFromLine(line) {
  const labeled = line.match(NAME_LABEL_RE);
  const source = labeled ? labeled[1] : line;
  if (/[@\d/\\:]/.test(source.replace(/^[^A-Za-z]*\|/, ''))) return null;
  if (SECTION_WORDS.test(source.trim())) return null;
  let words = cleanTokens(source).map(w => w.replace(/[.,;]+$/, '')).filter(Boolean);
  // Cut at the first stopword: everything after it belongs to another column.
  const stop = words.findIndex((w, i) => i > 0 && NAME_STOPWORDS.test(w));
  if (stop > 0) words = words.slice(0, stop);
  const candidate = words.join(' ');
  if (!candidate || candidate.length > 40) return null;
  if (BAD_NAME_TOKENS.test(candidate) || SKILL_PHRASES.has(candidate.toLowerCase())) return null;
  if (words.length < 1 || words.length > 4) return null;
  if (!words.every(w => /^[A-Za-z][A-Za-z.'’-]*$/.test(w))) return null;
  // a single word is only believable if it came from a "Name:" label or looks capitalised
  if (words.length === 1 && !labeled && !/^[A-Z][a-z]+$|^[A-Z]{3,}$/.test(words[0])) return null;
  const allCapsOrTitle = words.every(w => /^[A-Z][a-z.'’-]*$|^[A-Z.'’-]+$/.test(w));
  if (!allCapsOrTitle && !labeled) return null;
  return titleCase(candidate);
}

function extractName(lines, email) {
  for (const l of lines.slice(0, 60)) {
    if (NAME_LABEL_RE.test(l)) {
      const n = nameFromLine(l);
      if (n) return { full: n, confidence: 'high' };
    }
  }
  const head = lines.slice(0, 12);
  for (let i = 0; i < head.length; i++) {
    let n = nameFromLine(head[i]);
    if (!n) continue;
    // Designer headers often split the name over two lines: "SURYA PRAKASH" / "KUSHWAHA".
    // Skip one line of OCR noise in between.
    for (const k of [1, 2]) {
      const t = head[i + k] ? cleanTokens(head[i + k]) : [];
      if (t.length === 0 || (t.length === 1 && t[0].length < 3)) continue;
      if (t.length === 1 && /^[A-Z]{3,}$/.test(t[0]) && cleanTokens(head[i]).every(x => /^[A-Z.'’-]+$/.test(x))
        && n.split(' ').length < 3 && !BAD_NAME_TOKENS.test(t[0]) && !SECTION_WORDS.test(t[0])
        && !NAME_STOPWORDS.test(t[0]) && !SKILL_PHRASES.has(t[0].toLowerCase())) {
        n = `${n} ${titleCase(t[0])}`;
      }
      break;
    }
    return { full: n, confidence: 'high' };
  }
  if (email) {
    const local = email.split('@')[0].replace(/\d+/g, ' ').replace(/[._-]+/g, ' ').trim();
    const words = local.split(/\s+/).filter(w => w.length > 1);
    if (words.length >= 1 && words.length <= 3 && words.every(w => /^[a-z]+$/i.test(w))) {
      return { full: titleCase(words.join(' ')), confidence: 'low', fromEmail: true };
    }
  }
  return null;
}

const INDIAN_STATES = 'Andhra Pradesh|Arunachal Pradesh|Assam|Bihar|Chhattisgarh|Goa|Gujarat|Haryana|Himachal Pradesh|Jharkhand|Karnataka|Kerala|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Orissa|Punjab|Rajasthan|Sikkim|Tamil Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|West Bengal|Jammu and Kashmir|Delhi|U\\.?P\\.?';
const CITY_STATE_RE = new RegExp(`([A-Za-z][A-Za-z ]{2,24}?)\\s*,\\s*(${INDIAN_STATES})\\b`, 'i');
const DISTRICT_RE = /\bdist(?:rict|t)?\.?\s*[-:]?\s*([A-Za-z][A-Za-z ]{2,24})/i;

function cityFrom(text) {
  const known = text.match(CITY_RE);
  if (known) return [titleCase(known[1].replace(/\s+/g, ' ')), known[2] && known[2].trim()].filter(Boolean).join(', ');
  const cs = text.match(CITY_STATE_RE);
  if (cs) {
    const city = cs[1].trim();
    // "Dashmesh Nagar, Sangrur, Punjab": take the last comma part before the state, not the whole run
    return `${titleCase(city.split(',').pop().trim())}, ${titleCase(cs[2].replace(/\./g, ''))}`.replace(/\bUp\b/, 'UP');
  }
  const d = text.match(DISTRICT_RE);
  if (d) return titleCase(d[1].trim().replace(/\s+(raj|up|mp|hr|pb)$/i, ''));
  return null;
}

function extractLocation(lines) {
  const window = lines.slice(0, 100);
  // 1. Explicit "Location: X" / "City: X", also mid-line ("... • Phone: ... • Location: Nagpur").
  for (const l of window) {
    const m = l.match(/(?:^|[|•·,;]\s*)(?:current\s+|present\s+)?(?:location|city)\s*[:\-–]\s*([^|•·;]+)/i);
    if (m) {
      const v = m[1].trim().replace(/[,.\s]+$/, '');
      if (v && v.length <= 60) {
        const city = cityFrom(v);
        return { location: city || v, confidence: city ? 'high' : 'medium' };
      }
    }
  }
  // 2. Address blocks (they often wrap onto the next line): current/present before permanent.
  const blocks = [];
  window.forEach((l, i) => {
    const m = l.match(/^((?:current|present|permanent|correspondence|residential)\s+)?(?:address|residence)\s*[:\-–]?\s*(.*)$/i);
    if (m) blocks.push({ perm: /permanent/i.test(m[1] || ''), text: [m[2], window[i + 1], window[i + 2]].filter(Boolean).join(', ') });
  });
  blocks.sort((a, b) => Number(a.perm) - Number(b.perm));
  for (const b of blocks) {
    const city = cityFrom(b.text);
    if (city) return { location: city, confidence: 'medium' };
  }
  // 3a. A line carrying a 6-digit PIN code and a known city ("New Delhi — 110018").
  for (const l of window) {
    if (/\b\d{6}\b/.test(l) && l.length < 80) {
      const city = cityFrom(l.replace(/\b\d{6}\b/, ''));
      if (city) return { location: city, confidence: 'medium' };
    }
  }
  // 3b. A known city in the header (first lines, where the contact strip lives).
  for (const l of lines.slice(0, 20)) {
    if (l.length < 140) {
      const m = l.match(CITY_RE);
      if (m) return { location: [titleCase(m[1].replace(/\s+/g, ' ')), m[2] && m[2].trim()].filter(Boolean).join(', '), confidence: 'medium' };
    }
  }
  return null;
}

// Skills that are ordinary words/letters: only trusted when they appear as a
// standalone token in a delimited list (e.g. "Python, Go, R, SQL").
const AMBIGUOUS = new Set(['c', 'r', 'go', 'spring', 'express', 'swift', 'oracle', 'excel', 'vue', 'node', 'sales', 'sourcing', 'screening']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SKILL_MATCHERS = (() => {
  const canonical = new Map();
  SKILLS.forEach(s => canonical.set(s.toLowerCase(), s));
  const terms = [...canonical.keys(), ...Object.keys(ALIASES)];
  return terms.map(term => ({
    term,
    skill: canonical.get(term) || ALIASES[term],
    ambiguous: AMBIGUOUS.has(term),
    re: new RegExp(`(?<![A-Za-z0-9+#.])${escapeRe(term)}(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`, 'i'),
  }));
})();

function extractSkills(text, lines) {
  const found = new Set();
  const flat = text.replace(/\s+/g, ' ');
  const listTokens = new Set();
  for (const l of lines) {
    if ((l.match(/[,|;•·\/]/g) || []).length >= 2 || /^skills?\b/i.test(l)) {
      l.replace(/^[A-Za-z &]*:/, '').split(/[,|;•·\/]/).forEach(t => listTokens.add(t.trim().toLowerCase()));
    }
  }
  for (const m of SKILL_MATCHERS) {
    if (m.ambiguous) {
      if (listTokens.has(m.term)) found.add(m.skill);
    } else if (m.re.test(flat)) {
      found.add(m.skill);
    }
  }
  return [...found].slice(0, 40);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const YEAR = '(?:19|20)\\d{2}';
const DATE = `(?:(?:\\d{1,2}[\\s./-]*)?${MON}\\.?[\\s,.'\\]\\[-]*${YEAR}|\\d{1,2}[/.-]\\d{1,2}[/.-]${YEAR}|\\d{1,2}[/.-]${YEAR}|${YEAR})`;
const OPEN_END = '(?:present|till\\s+date|till\\s+now|to\\s+date|currently|current|ongoing|now|date)';
const RANGE_RE = new RegExp(`\\[?(${DATE})\\]?\\s*(?:-|–|—|to|till)+\\s*\\[?(${DATE}|${OPEN_END})\\]?`, 'gi');
// A date range on or right under one of these is study/training, not a job.
const NOT_JOB = /\b(b\.?\s?tech|m\.?\s?tech|b\.?e\.?\b|b\.?sc|m\.?sc|bca|mca|b\.?com|m\.?com|b\.?a\.?\b|m\.?a\.?\b|mba|bba|diploma|degree|bachelor|master|university|college|school|cgpa|percentage|board|graduat|certificat|course|intern(?:ship)?|trainee|training)\b/i;

function monthIndex(token, isEnd, now) {
  const t = token.trim().toLowerCase();
  if (new RegExp(`^${OPEN_END}$`, 'i').test(t)) return now.getFullYear() * 12 + now.getMonth();
  const year = parseInt((t.match(new RegExp(YEAR)) || [])[0], 10);
  if (!year) return null;
  const name = t.match(new RegExp(MON));
  if (name) return year * 12 + MONTHS.indexOf(name[0].slice(0, 3));
  const num = t.match(/(?:^|\D)(\d{1,2})[/.-]\d{4}$/); // mm/yyyy or dd/mm/yyyy
  if (num && +num[1] >= 1 && +num[1] <= 12) return year * 12 + (+num[1] - 1);
  return year * 12 + (isEnd ? 11 : 0); // year only
}

/** Work-history span from date ranges: union of ranges, so overlaps and gaps are handled. */
function estimateExperienceYears(lines, now) {
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const spans = [];
  lines.forEach((line, i) => {
    RANGE_RE.lastIndex = 0;
    let m;
    while ((m = RANGE_RE.exec(line))) {
      if (NOT_JOB.test(line) || (i > 0 && NOT_JOB.test(lines[i - 1]) && lines[i - 1].length < 120)) continue;
      const start = monthIndex(m[1], false, now);
      let end = monthIndex(m[2], true, now);
      if (start === null || end === null || start > nowIdx) continue;
      end = Math.min(end, nowIdx);
      if (end < start || end - start > 12 * 45) continue;
      spans.push([start, end + 1]);
    }
  });
  if (!spans.length) return null;
  spans.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let [cs, ce] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else { months += ce - cs; [cs, ce] = [s, e]; }
  }
  months += ce - cs;
  if (months < 3) return null;
  return Math.round((months / 12) * 2) / 2;
}

/** Years stated in the text ("5+ years of experience"); several per-employer figures are summed. */
function statedExperienceYears(text) {
  const flat = text.replace(/\s+/g, ' ');
  const total = flat.match(/(?:total|overall)\s+(?:work\s+)?experience\s*(?:of|is|:|-|–)?\s*(\d{1,2}(?:\.\d)?)/i);
  if (total) return parseFloat(total[1]);
  const re = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s*(?:and\s*\d+\s*months?\s*)?(?:of\s+)?(?:[a-z-]+\s+){0,2}?experience(\s+(?:in|at|with|as)\b)?/gi;
  const hits = [];
  let m;
  while ((m = re.exec(flat))) hits.push({ n: parseFloat(m[1]), perEmployer: Boolean(m[2]) });
  if (!hits.length) {
    const alt = flat.match(/experience\s*(?:of|:)?\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/i);
    return alt ? parseFloat(alt[1]) : null;
  }
  if (hits.length === 1) return hits[0].n;
  // "1 year experience in X" + "1.5 year experience in Y": per-employer figures add up.
  if (hits.every(h => h.perEmployer)) return hits.reduce((a, h) => a + h.n, 0);
  return Math.max(...hits.map(h => h.n));
}

function extractExperience(text, lines, now) {
  const stated = statedExperienceYears(text);
  if (stated !== null && stated >= 0 && stated <= 50) return { years: stated, source: 'stated' };
  const est = estimateExperienceYears(lines, now);
  return est === null ? { years: null, source: null } : { years: est, source: 'estimated' };
}

/**
 * @param {string} text raw extracted text
 * @param {{defaultCountry?: string}} [opts] ISO alpha-2 used only for numbers lacking +CC
 */
function parseResumeText(text, opts = {}) {
  const defaultCountry = opts.defaultCountry ? opts.defaultCountry.toUpperCase() : null;
  const now = opts.now || new Date();
  const lines = cleanLines(text);
  const warnings = [];
  const confidence = {};

  const email = extractEmail(text);
  if (email) confidence.email = 'high'; else warnings.push('missing_email');

  const phoneRes = extractPhone(text, defaultCountry);
  if (!phoneRes) warnings.push('missing_phone');
  else {
    confidence.phone = phoneRes.confidence;
    if (!phoneRes.phoneCountry) warnings.push('phone_country_unknown');
  }

  const name = extractName(lines, email);
  let firstName = null;
  let lastName = null;
  if (name) {
    const parts = name.full.split(/\s+/);
    // "Surya Prakash Kushwaha" -> first "Surya Prakash", last "Kushwaha" (the usual Indian convention; HR can edit).
    firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
    lastName = parts.length > 1 ? parts[parts.length - 1] : null;
    confidence.name = name.confidence;
    if (name.fromEmail) warnings.push('name_guessed_from_email');
  } else {
    warnings.push('missing_name');
  }
  if (name && !lastName) warnings.push('missing_last_name');

  const loc = extractLocation(lines);
  if (loc) confidence.location = loc.confidence;

  const exp = extractExperience(text, lines, now);
  const skills = extractSkills(text, lines);
  if (!skills.length) warnings.push('no_skills_found');

  return {
    candidate: {
      firstName,
      lastName,
      email,
      phone: phoneRes ? phoneRes.phone : null,
      phoneCountry: phoneRes ? phoneRes.phoneCountry : null,
      location: loc ? loc.location : null,
      linkedinUrl: extractLinkedin(text),
      skills,
    },
    experienceYears: exp.years,
    experienceSource: exp.source,
    confidence,
    warnings,
  };
}

module.exports = { parseResumeText, extractEmail, extractPhone, extractSkills, extractName, cleanLines };
