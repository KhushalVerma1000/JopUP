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
const BAD_NAME_TOKENS = /\b(resume|curriculum|vitae|engineer|developer|manager|analyst|executive|consultant|designer|intern|fresher|objective|summary|profile|address|email|mobile|phone|contact|experience|education|skills|linkedin|github|http|www)\b/i;

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

function nameFromLine(line) {
  const labeled = line.match(NAME_LABEL_RE);
  const candidate = (labeled ? labeled[1] : line).replace(/[,|].*$/, '').trim();
  if (!candidate || candidate.length > 40) return null;
  if (/[@\d/\\:]/.test(candidate)) return null;
  if (SECTION_WORDS.test(candidate) || BAD_NAME_TOKENS.test(candidate)) return null;
  const words = candidate.split(/\s+/);
  if (words.length < 1 || words.length > 4) return null;
  if (!words.every(w => /^[A-Za-z][A-Za-z.'’-]*$/.test(w))) return null;
  // a single word is only believable if it came from a "Name:" label or looks capitalised
  if (words.length === 1 && !labeled && !/^[A-Z][a-z]+$|^[A-Z]{3,}$/.test(words[0])) return null;
  const allCapsOrTitle = words.every(w => /^[A-Z][a-z.'’-]*$|^[A-Z.'’-]+$/.test(w));
  if (!allCapsOrTitle && !labeled) return null;
  return titleCase(candidate);
}

function extractName(lines, email) {
  for (const l of lines.slice(0, 40)) {
    if (NAME_LABEL_RE.test(l)) {
      const n = nameFromLine(l);
      if (n) return { full: n, confidence: 'high' };
    }
  }
  for (const l of lines.slice(0, 12)) {
    const n = nameFromLine(l);
    if (n) return { full: n, confidence: 'high' };
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

function extractLocation(lines) {
  for (const l of lines.slice(0, 60)) {
    const m = l.match(/^(?:current\s+|present\s+|permanent\s+)?(?:location|address|city|residence)\s*[:\-–]\s*(.+)$/i);
    if (m && m[1].length <= 120) {
      const city = m[1].match(CITY_RE);
      return { location: city ? [titleCase(city[1].replace(/\s+/g, ' ')), city[2] && city[2].trim()].filter(Boolean).join(', ') : m[1].trim().replace(/[,.\s]+$/, ''), confidence: city ? 'high' : 'medium' };
    }
  }
  for (const l of lines.slice(0, 20)) {
    const m = l.match(CITY_RE);
    if (m && l.length < 140) {
      return { location: [titleCase(m[1].replace(/\s+/g, ' ')), m[2] && m[2].trim()].filter(Boolean).join(', '), confidence: 'medium' };
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

function extractExperienceYears(text) {
  const flat = text.replace(/\s+/g, ' ');
  const patterns = [
    /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s*(?:and\s*\d+\s*months?\s*)?(?:of\s+)?(?:total\s+|relevant\s+|professional\s+|work\s+)?experience/i,
    /experience\s*(?:of|:)?\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/i,
    /total\s+experience\s*[:\-–]?\s*(\d{1,2}(?:\.\d)?)/i,
  ];
  for (const re of patterns) {
    const m = flat.match(re);
    if (m) {
      const n = parseFloat(m[1]);
      if (n >= 0 && n <= 50) return n;
    }
  }
  return null;
}

/**
 * @param {string} text raw extracted text
 * @param {{defaultCountry?: string}} [opts] ISO alpha-2 used only for numbers lacking +CC
 */
function parseResumeText(text, opts = {}) {
  const defaultCountry = opts.defaultCountry ? opts.defaultCountry.toUpperCase() : null;
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
    firstName = parts[0];
    lastName = parts.slice(1).join(' ') || null;
    confidence.name = name.confidence;
    if (name.fromEmail) warnings.push('name_guessed_from_email');
  } else {
    warnings.push('missing_name');
  }
  if (name && !lastName) warnings.push('missing_last_name');

  const loc = extractLocation(lines);
  if (loc) confidence.location = loc.confidence;

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
    experienceYears: extractExperienceYears(text),
    confidence,
    warnings,
  };
}

module.exports = { parseResumeText, extractEmail, extractPhone, extractSkills, extractName, cleanLines };
