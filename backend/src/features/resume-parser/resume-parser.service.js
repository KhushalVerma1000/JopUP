const { db, schema } = require('../../utils/db');
const { and, eq, inArray } = require('drizzle-orm');
const { extractText, ExtractError } = require('./extract');
const { parseResumeText } = require('./fields');
const { normalizePhone } = require('../../utils/phone');
const candidatesService = require('../candidates/candidates.service');
const { PossibleDuplicateError, ConflictError } = require('../../utils/errors');

const PARSER_VERSION = 'rules-1';
const RAW_TEXT_CAP = 20000;

/** Parse a single uploaded file into a candidate draft. Never throws. */
async function parseFile(file, opts = {}) {
  const base = { fileName: file.originalname, size: file.size };
  try {
    const { text, method } = await extractText(file.buffer, file.originalname);
    const parsed = parseResumeText(text, opts);
    const c = parsed.candidate;
    const complete = Boolean(c.firstName && (c.email || c.phone));
    return {
      ...base,
      status: complete ? 'parsed' : 'incomplete',
      extractMethod: method,
      candidate: c,
      parsedResume: {
        parserVersion: PARSER_VERSION,
        extractMethod: method,
        experienceYears: parsed.experienceYears,
        sourceFileName: file.originalname,
        rawText: text.slice(0, RAW_TEXT_CAP),
      },
      confidence: parsed.confidence,
      warnings: parsed.warnings,
    };
  } catch (err) {
    if (err instanceof ExtractError) {
      return { ...base, status: 'failed', errorCode: err.code, error: err.message };
    }
    return { ...base, status: 'failed', errorCode: 'internal', error: 'Unexpected error while parsing this file.' };
  }
}

/** Parse files one after another (OCR worker is shared, so no parallelism). */
async function parseMany(files, opts = {}) {
  const results = [];
  for (const f of files) results.push(await parseFile(f, opts));
  flagBatchDuplicates(results);
  return results;
}

function flagBatchDuplicates(results) {
  const seen = new Map();
  results.forEach((r, i) => {
    if (r.status === 'failed') return;
    const keys = [];
    if (r.candidate.email) keys.push(`e:${r.candidate.email}`);
    const p = normalizePhone(r.candidate.phone, r.candidate.phoneCountry);
    if (p) keys.push(`p:${p}`);
    for (const k of keys) {
      if (seen.has(k)) {
        r.warnings.push('duplicate_in_batch');
        r.duplicateOfIndex = seen.get(k);
        return;
      }
      seen.set(k, i);
    }
  });
}

/**
 * Best-effort: attach `existingCandidate` to drafts that match someone already
 * in this org (by email, or by normalised phone — ADR-2). A DB hiccup must not
 * fail the parse, so errors are swallowed and the check is simply skipped.
 */
async function annotateExisting(orgId, results) {
  try {
    const emails = [...new Set(results.map(r => r.candidate && r.candidate.email).filter(Boolean))];
    const phones = [...new Set(results.map(r => r.candidate && normalizePhone(r.candidate.phone, r.candidate.phoneCountry)).filter(Boolean))];
    const byEmail = new Map();
    const byPhone = new Map();
    if (emails.length) {
      const rows = await db.select().from(schema.candidate)
        .where(and(eq(schema.candidate.organisationId, orgId), inArray(schema.candidate.email, emails)));
      rows.forEach(r => byEmail.set(r.email, r));
    }
    if (phones.length) {
      const rows = await db.select().from(schema.candidate)
        .where(and(eq(schema.candidate.organisationId, orgId), inArray(schema.candidate.phoneNormalized, phones)));
      rows.forEach(r => byPhone.set(r.phoneNormalized, r));
    }
    for (const r of results) {
      if (!r.candidate) continue;
      const hit = (r.candidate.email && byEmail.get(r.candidate.email))
        || byPhone.get(normalizePhone(r.candidate.phone, r.candidate.phoneCountry));
      if (hit) {
        r.existingCandidate = { id: hit.id, firstName: hit.firstName, lastName: hit.lastName, email: hit.email, phone: hit.phone };
        r.warnings.push('already_in_database');
      }
    }
  } catch (err) {
    console.error('[resume-parser] existing-candidate check skipped:', err.message);
  }
  return results;
}

/**
 * Create candidates from reviewed drafts. Each item goes through the normal
 * candidatesService.createCandidate so email conflicts, phone-duplicate
 * warnings (ADR-2) and audit logging behave exactly as for a manual add.
 * One bad row never aborts the rest.
 */
async function bulkCreate(orgId, userId, { ownerTeamId, items }) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const { parsedResume, ...fields } = items[i];
    const data = { ...fields, ownerTeamId, source: 'resume_upload', sourceRef: fields.sourceRef || (parsedResume && parsedResume.sourceFileName) || undefined };
    if (parsedResume) data.parsedResume = parsedResume;
    try {
      const candidate = await candidatesService.createCandidate(orgId, data, userId);
      results.push({ index: i, status: 'created', candidate });
    } catch (err) {
      if (err instanceof PossibleDuplicateError) {
        results.push({ index: i, status: 'duplicate', error: err.message, existing: err.data && err.data.possibleDuplicate });
      } else if (err instanceof ConflictError) {
        results.push({ index: i, status: 'conflict', error: err.message });
      } else {
        results.push({ index: i, status: 'error', error: err.isOperational ? err.message : 'Could not create this candidate.' });
      }
    }
  }
  return results;
}

module.exports = { parseFile, parseMany, annotateExisting, bulkCreate, PARSER_VERSION };
