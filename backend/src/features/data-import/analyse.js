/**
 * The analyser: grid of cells in, understanding out. Pure and deterministic,
 * no database, so every decision here is unit-testable.
 *
 * analyseWorkbook(sheets, opts) -> { sheets: [analysis], totals }
 *   sheets: [{ name, rows: any[][] }]            (see reader.js)
 *   opts:   { defaultCountry, now, dateOrder, statusOverrides, mappingOverrides }
 *
 * Nothing is written anywhere. The wizard shows this, HR corrects it, and a
 * later step commits it.
 */
const { matchHeader, contentFit, sniffColumn, normHeader } = require('./headers');
const { interpretStatus } = require('./statusMap');
const N = require('./normalize');

const HEADER_SCAN_ROWS = 20;
const AUTO = 0.8;     // accepted without asking
const REVIEW = 0.5;   // shown as "please check"; below this the column is kept as an extra field

const IDENTITY = ['candidateName', 'firstName', 'phone', 'email'];
const TRACKER = ['client', 'designation', 'lineupDate', 'interviewDate', 'joiningDate', 'status'];
const CUSTOM_KEYS = ['currentCtc', 'expectedCtc', 'noticePeriod', 'qualification', 'currentEmployer', 'resumeLink'];

const rowIsBlank = (row) => !row || row.every((c) => N.isBlank(c));

/** The header is the early row where the most cells are recognisable column names. */
function findHeaderRow(rows) {
  let best = { index: -1, score: 0 };
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i += 1) {
    const row = rows[i] || [];
    const fields = new Set();
    let strings = 0;
    row.forEach((c) => {
      if (typeof c === 'string' && c.trim()) strings += 1;
      const m = matchHeader(c);
      if (m && m.field !== 'srNo') fields.add(m.field);
    });
    if (fields.size < 2 || strings < 2) continue;
    if (fields.size > best.score) best = { index: i, score: fields.size };
  }
  return best.index;
}

function buildColumns(rows, headerIdx, opts) {
  const header = rows[headerIdx] || [];
  const body = rows.slice(headerIdx + 1);
  const cols = [];
  header.forEach((h, c) => {
    const label = N.text(h);
    const values = body.map((r) => (r ? r[c] : null));
    if (!label && values.every(N.isBlank)) return; // empty column
    const ov = opts.mappingOverrides && opts.mappingOverrides[normHeader(label)];
    let field = null; let confidence = 0; let how = 'none';
    if (ov) { field = ov === 'ignore' ? null : ov; confidence = 1; how = 'chosen'; }
    else {
      const m = matchHeader(label);
      if (m) {
        const fit = contentFit(m.field, values, opts);
        confidence = fit === null ? m.score * 0.85 : m.score * (0.55 + 0.45 * fit);
        field = m.field; how = 'header';
      } else {
        const s = sniffColumn(values, opts);
        if (s) { field = s.field; confidence = s.score; how = 'values'; }
      }
    }
    cols.push({ index: c, label: label || `Column ${c + 1}`, field, confidence: Math.round(confidence * 100) / 100, how, sample: values.filter((v) => !N.isBlank(v)).slice(0, 3).map((v) => N.text(v)) });
  });

  // A bare "Date" column becomes the lineup date when nothing else claims it.
  const generic = cols.filter((c) => c.field === 'genericDate');
  const has = (f) => cols.some((c) => c.field === f);
  generic.forEach((c) => {
    if (!has('lineupDate')) { c.field = 'lineupDate'; c.confidence = Math.min(c.confidence, 0.6); c.how = 'bare date'; }
    else if (!has('interviewDate')) { c.field = 'interviewDate'; c.confidence = Math.min(c.confidence, 0.55); c.how = 'bare date'; }
    else c.field = null;
  });

  // One column per field: the most confident wins; a second phone becomes the alternate.
  const best = new Map();
  cols.forEach((c) => { if (c.field && (!best.has(c.field) || c.confidence > best.get(c.field).confidence)) best.set(c.field, c); });
  cols.forEach((c) => {
    if (!c.field || best.get(c.field) === c) return;
    c.field = c.field === 'phone' && !best.has('altPhone') ? (best.set('altPhone', c), 'altPhone') : null;
  });
  cols.forEach((c) => {
    if (c.field && c.confidence < REVIEW) { c.field = null; }
    c.status = !c.field ? 'extra' : c.confidence >= AUTO ? 'auto' : 'review';
  });
  return cols;
}

const kindOf = (fieldSet) => {
  const identity = IDENTITY.some((f) => fieldSet.has(f));
  if (!identity) return 'unknown';
  return TRACKER.some((f) => fieldSet.has(f)) ? 'lineup' : 'candidates';
};

function analyseSheet(sheet, opts = {}) {
  const rows = (sheet.rows || []).map((r) => (r ? r.slice() : []));
  const out = { name: sheet.name, kind: 'unknown', headerRow: null, columns: [], dateOrder: null, sheetDate: null, records: [], summary: null, warnings: [] };
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    out.warnings.push({ code: 'no_header', message: 'No column headings found. Add a heading row (Name, Phone, Client…) and upload again.' });
    out.summary = { rows: 0, people: 0, trackers: 0, errors: 0, warnings: 0, unknownStatuses: [], clients: [], designations: [] };
    return out;
  }
  out.headerRow = headerIdx + 1;
  const columns = buildColumns(rows, headerIdx, opts);
  out.columns = columns;
  const by = {}; columns.forEach((c) => { if (c.field) by[c.field] = c; });
  const fieldSet = new Set(Object.keys(by));
  out.kind = kindOf(fieldSet);

  // date order: one answer for the whole sheet, taken from every date column
  const dateCols = ['lineupDate', 'interviewDate', 'joiningDate'].map((f) => by[f]).filter(Boolean);
  const dateValues = dateCols.flatMap((c) => rows.slice(headerIdx + 1).map((r) => (r ? r[c.index] : null)));
  const det = opts.dateOrder ? { order: opts.dateOrder, certain: true } : N.detectDateOrder(dateValues);
  out.dateOrder = det;
  const order = det.order === 'mixed' ? 'dmy' : det.order;
  if (det.order === 'mixed') out.warnings.push({ code: 'mixed_date_order', message: 'Some dates are day-first and some month-first. Check the dates in the preview.' });
  else if (dateCols.length && !det.certain) out.warnings.push({ code: 'date_order_assumed', message: 'Dates like 05/10/2026 could be 5 Oct or 10 May. Read as day-first. Change it if that is wrong.' });

  // one tab per day: the tab name stands in for a missing lineup-date column
  if (!by.lineupDate) {
    const d = N.parseDate(sheet.name, { order, now: opts.now });
    if (d.date) out.sheetDate = d.date;
  }

  const cell = (row, f) => (by[f] ? row[by[f].index] : null);
  const unknownStatuses = new Map(); const clients = new Map(); const designations = new Map(); const stages = {};
  const seen = new Map(); // identity key -> first row number
  const seenTracker = new Set();
  const extraCols = columns.filter((c) => !c.field && c.label);
  let errors = 0; let warns = 0; let trackerCount = 0; let people = 0;

  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (rowIsBlank(row)) continue;
    const nonBlank = row.filter((c) => !N.isBlank(c));
    if (nonBlank.length <= 2 && /^(total|grand total|count|summary)\b/i.test(String(nonBlank[0]))) continue;
    if (row.filter((c, i) => matchHeader(c) && columns.find((x) => x.index === i && x.field)).length >= 2) continue; // repeated heading row

    const issues = [];
    // — candidate —
    let { firstName, lastName } = by.candidateName ? N.splitName(cell(row, 'candidateName')) : { firstName: null, lastName: null };
    if (by.firstName) {
      const f = N.splitName(cell(row, 'firstName')); firstName = f.firstName || firstName;
      if (f.lastName) lastName = f.lastName;
    }
    if (by.lastName) { const l = N.text(cell(row, 'lastName')); if (l) lastName = N.splitName(l).firstName; }
    const ph = N.parsePhoneCell(cell(row, 'phone'), opts.defaultCountry);
    const alt = N.parsePhoneCell(cell(row, 'altPhone'), opts.defaultCountry);
    const em = N.cleanEmail(cell(row, 'email'));
    // A row with no person and nothing else is noise. One with a client, date or status but no
    // candidate is a mistake HR should see, so it stays and is flagged below.
    const otherCells = ['client', 'designation', 'status', 'lineupDate', 'interviewDate', 'joiningDate'].some((f) => !N.isBlank(cell(row, f)));
    if (!firstName && !ph.phone && !em.email && !otherCells) continue;
    if (!firstName) issues.push({ level: 'error', code: 'missing_name', message: 'No name on this row' });
    if (!ph.phone && !em.email) issues.push({ level: 'warn', code: 'no_contact', message: 'No phone or email' });
    if (ph.phone && ph.valid === false) issues.push({ level: 'warn', code: 'invalid_phone', message: `Phone "${ph.phone}" does not look valid${opts.defaultCountry ? '' : ' (no default country is set)'}` });
    if (em.email && em.valid === false) issues.push({ level: 'warn', code: 'invalid_email', message: `Email "${em.email}" does not look valid` });
    const candidate = {
      firstName, lastName,
      phone: ph.phone, phoneCountry: ph.phone ? ph.phoneCountry : null, phoneNormalized: ph.phoneNormalized,
      altPhone: ph.alt || alt.phone || null,
      email: em.valid ? em.email : null,
      location: N.text(cell(row, 'location')),
      experienceYears: N.parseExperience(cell(row, 'experience')),
      skills: N.text(cell(row, 'skills')) ? String(cell(row, 'skills')).split(/[,;|/]+/).map((s) => s.trim()).filter(Boolean).slice(0, 40) : [],
      sourceText: N.text(cell(row, 'source')),
    };
    // — pipeline —
    const dt = (f) => { const v = cell(row, f); if (N.isBlank(v)) return null; const p = N.parseDate(v, { order, now: opts.now }); if (!p.date) issues.push({ level: 'warn', code: 'unparsed_date', message: `Could not read the date "${N.text(v)}"` }); return p.date; };
    const lineupDate = dt('lineupDate') || out.sheetDate || null;
    const interviewDate = dt('interviewDate');
    const joiningDate = dt('joiningDate');
    const statusText = N.text(cell(row, 'status'));
    const st = statusText ? interpretStatus(statusText, opts.statusOverrides) : null;
    if (st && st.matched === null) {
      issues.push({ level: 'warn', code: 'unknown_status', message: `Status "${statusText}" is not recognised` });
      const e = unknownStatuses.get(st.key) || { key: st.key, text: statusText, count: 0 }; e.count += 1; unknownStatuses.set(st.key, e);
    }
    const clientName = N.text(cell(row, 'client'));
    const designation = N.text(cell(row, 'designation'));
    const tracker = {
      clientName, designation,
      locationName: N.text(cell(row, 'clientLocation')),
      lineupDate, interviewDate, joiningDate,
      statusText,
      stageKey: st ? st.stageKey : null, trackerStatus: st ? st.status : null, reason: st ? st.reason : null,
      remarks: N.text(cell(row, 'remarks')),
      recruiterName: N.text(cell(row, 'recruiter')),
    };
    // dates tell us how far someone got, even when the status cell is vague
    if (!tracker.stageKey) {
      if (joiningDate) { tracker.stageKey = 'joined'; tracker.trackerStatus = tracker.trackerStatus || 'placed'; }
      else if (interviewDate) tracker.stageKey = 'interview';
      else if (lineupDate && (clientName || designation)) tracker.stageKey = 'lineup';
      tracker.trackerStatus = tracker.trackerStatus || (tracker.stageKey ? 'active' : null);
    }
    const hasTracker = Boolean(clientName || designation || lineupDate || interviewDate || joiningDate || statusText);
    const custom = {};
    CUSTOM_KEYS.forEach((k) => { const v = N.text(cell(row, k)); if (v) custom[k] = v; });
    extraCols.forEach((c) => { const v = N.text(row[c.index]); if (v) custom[c.label] = v; });

    // — identity & repeats —
    const key = ph.phoneNormalized || (ph.phone ? `p:${String(ph.phone).replace(/\D/g, '').slice(-10)}` : null) || (em.email ? `e:${em.email}` : null);
    let duplicateOfRow = null;
    if (key) {
      if (seen.has(key)) {
        duplicateOfRow = seen.get(key);
        const tkey = `${key}|${(clientName || '').toLowerCase()}|${(designation || '').toLowerCase()}|${lineupDate || ''}`;
        if (hasTracker && seenTracker.has(tkey)) issues.push({ level: 'warn', code: 'duplicate_row', message: `Same candidate, client, position and date as row ${duplicateOfRow}` });
        else issues.push({ level: 'info', code: 'same_candidate', message: `Same person as row ${duplicateOfRow} (one candidate, another lineup)` });
      } else { seen.set(key, r + 1); people += 1; }
      if (hasTracker) seenTracker.add(`${key}|${(clientName || '').toLowerCase()}|${(designation || '').toLowerCase()}|${lineupDate || ''}`);
    } else people += 1;

    if (hasTracker) {
      trackerCount += 1;
      if (clientName) clients.set(clientName.toLowerCase(), { name: (clients.get(clientName.toLowerCase()) || { name: clientName }).name, count: ((clients.get(clientName.toLowerCase()) || {}).count || 0) + 1 });
      if (designation) designations.set(designation.toLowerCase(), { name: designation, count: ((designations.get(designation.toLowerCase()) || {}).count || 0) + 1 });
      if (tracker.stageKey) stages[tracker.stageKey] = (stages[tracker.stageKey] || 0) + 1;
    }
    errors += issues.filter((i) => i.level === 'error').length;
    warns += issues.filter((i) => i.level === 'warn').length;
    out.records.push({ row: r + 1, candidate, tracker: hasTracker ? tracker : null, custom, duplicateOfRow, issues, blocking: issues.some((i) => i.level === 'error') });
  }

  out.summary = {
    rows: out.records.length, people, trackers: trackerCount, errors, warnings: warns, stages,
    unknownStatuses: [...unknownStatuses.values()].sort((a, b) => b.count - a.count),
    clients: [...clients.values()].sort((a, b) => b.count - a.count),
    designations: [...designations.values()].sort((a, b) => b.count - a.count),
  };
  return out;
}

function analyseWorkbook(sheets, opts = {}) {
  const analysed = sheets.map((s) => analyseSheet(s, opts));
  const sum = (f) => analysed.reduce((a, s) => a + (s.summary ? s.summary[f] || 0 : 0), 0);
  return { sheets: analysed, totals: { sheets: analysed.length, usableSheets: analysed.filter((s) => s.kind !== 'unknown').length, rows: sum('rows'), people: sum('people'), trackers: sum('trackers'), errors: sum('errors'), warnings: sum('warnings') } };
}

module.exports = { analyseWorkbook, analyseSheet, findHeaderRow, buildColumns };
