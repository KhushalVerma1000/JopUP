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
const { resolveClient, clientForSheet } = require('./clientHint');

const HEADER_SCAN_ROWS = 20;
const AUTO = 0.8;     // accepted without asking
const REVIEW = 0.5;   // shown as "please check"; below this the column is kept as an extra field

const IDENTITY = ['candidateName', 'firstName', 'phone', 'email'];
const TRACKER = ['client', 'designation', 'lineupDate', 'interviewDate', 'joiningDate', 'status'];
const CUSTOM_KEYS = ['currentCtc', 'expectedCtc', 'noticePeriod', 'qualification', 'currentEmployer', 'resumeLink', 'sourcingDate'];

// Columns whose heading we believe less than their contents. A "Recruiter" column full of Reached / Not Reached
// is a status column under the wrong heading; a "Remarks" column of 3.5 LPA and 30K is the expected salary.
const STATUS_STEAL = new Set(['recruiter', 'expectedCtc', 'currentCtc', 'qualification', 'currentEmployer', 'noticePeriod', 'source', 'experience']);
const SALARY_STEAL = new Set(['remarks', 'recruiter']);
const NAME_LIKE = /^[A-Za-z][A-Za-z.'-]*(\s[A-Za-z.'-]+){0,2}$/;

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


/**
 * Trust the contents over the heading when they disagree. Real trackers often have a heading row that is one
 * column out of step with the data (a column was added under it, or a heading was never typed), so the values
 * below "Recruiter" are statuses and the real recruiter names sit in the next, unheaded column.
 * Only unambiguous cases are changed, and every change is shown as "check" with a note saying why.
 */
function reconcileByValues(cols, valuesAt, opts) {
  const vals = (c) => valuesAt.get(c.index) || [];
  const filled = (c) => vals(c).filter((v) => !N.isBlank(v));
  const claimed = (f) => cols.some((c) => c.field === f);
  let statusHeld = cols.some((c) => c.field === 'status' && c.how === 'header' && filled(c).length >= 3);
  const moved = [];
  cols.forEach((c) => {
    if (c.how !== 'header' || !c.field || filled(c).length < 3) return;
    if (STATUS_STEAL.has(c.field) && !statusHeld) {
      const fit = contentFit('status', vals(c));
      if (fit >= 0.6) {
        c.note = `Heading says “${c.label}” but the values look like statuses`; c.field = 'status'; c.confidence = Math.round((0.55 + 0.3 * fit) * 100) / 100; c.how = 'values';
        statusHeld = true; moved.push(c); return;
      }
    }
    if (SALARY_STEAL.has(c.field) && !claimed('expectedCtc') && contentFit('expectedCtc', vals(c)) >= 0.7) {
      c.note = `Heading says “${c.label}” but the values look like expected salary`; c.field = 'expectedCtc'; c.confidence = 0.65; c.how = 'values'; moved.push(c);
    }
  });
  // a "Remarks" column where people also type Reached / No show / Rejected: read those as status as well
  const remarksCol = cols.find((c) => c.field === 'remarks' && c.how === 'header');
  if (remarksCol && !claimed('status') && filled(remarksCol).length >= 3 && contentFit('status', vals(remarksCol)) >= 0.3) {
    remarksCol.statusToo = true; remarksCol.note = 'Short status words here (Reached, No show…) are also read as the status';
  }
  // the columns right after a moved one are the ones that lost their heading
  moved.forEach((m) => {
    for (let k = 1; k <= 2; k += 1) {
      const next = cols.find((c) => c.index === m.index + k);
      if (!next || next.field || !next.blankLabel) continue;
      const f = filled(next); if (f.length < 3) continue;
      const strings = f.filter((v) => typeof v === 'string');
      const nameShare = strings.filter((v) => v.length <= 30 && NAME_LIKE.test(v.trim())).length / f.length;
      const distinct = new Set(strings.map((v) => v.trim().toLowerCase())).size;
      if (!claimed('recruiter') && nameShare >= 0.8 && distinct <= 40 && contentFit('status', vals(next)) < 0.5) {
        next.field = 'recruiter'; next.confidence = 0.55; next.how = 'values'; next.note = 'No heading; the values look like recruiter names'; continue;
      }
      if (!claimed('remarks') && strings.length / f.length >= 0.6 && strings.some((v) => v.trim().length >= 4)) {
        next.field = 'remarks'; next.confidence = 0.5; next.how = 'values'; next.note = 'No heading; the values look like remarks';
      }
    }
  });
}

function buildColumns(rows, headerIdx, opts, endIdx) {
  const header = rows[headerIdx] || [];
  const body = rows.slice(headerIdx + 1, endIdx === undefined ? rows.length : endIdx);
  const cols = []; const valuesAt = new Map();
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
    valuesAt.set(c, values);
    cols.push({ index: c, label: label || `Column ${c + 1}`, blankLabel: !label, field, confidence: Math.round(confidence * 100) / 100, how, sample: values.filter((v) => !N.isBlank(v)).slice(0, 3).map((v) => N.text(v)) });
  });

  reconcileByValues(cols, valuesAt, opts);

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

/** A row that looks like a heading: at least three recognisable columns, one of them the candidate's name. */
function isHeadingRow(row) {
  const fields = new Set(); let strings = 0;
  (row || []).forEach((c) => {
    if (typeof c === 'string' && c.trim()) strings += 1;
    const m = matchHeader(c);
    if (m && m.field !== 'srNo') fields.add(m.field);
  });
  return fields.size >= 3 && strings >= 3 && (fields.has('candidateName') || fields.has('firstName'));
}
const labelsKey = (row) => (row || []).map(normHeader).filter(Boolean).join('|');

/**
 * Split a sheet into tables. Most sheets have one. Some have a second table pasted underneath with its own
 * (different) headings; reading it with the first table's columns shifts every value one place.
 * A heading row identical to the current one is just a repeated heading and stays in the same table.
 */
function findBlocks(rows, headerIdx) {
  const blocks = [{ headerIdx, labels: labelsKey(rows[headerIdx]) }];
  const repeatRows = new Set();
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    if (!isHeadingRow(rows[r])) continue;
    const k = labelsKey(rows[r]);
    if (k === blocks[blocks.length - 1].labels) repeatRows.add(r);
    else blocks.push({ headerIdx: r, labels: k });
  }
  blocks.forEach((b, i) => { b.end = i + 1 < blocks.length ? blocks[i + 1].headerIdx : rows.length; });
  return { blocks, repeatRows };
}

function analyseSheet(sheet, opts = {}) {
  const rows = (sheet.rows || []).map((r) => (r ? r.slice() : []));
  const out = { name: sheet.name, kind: 'unknown', headerRow: null, columns: [], dateOrder: null, sheetDate: null, records: [], summary: null, warnings: [] };
  let headerIdx = findHeaderRow(rows);
  // the best-scoring heading can be a later table's; the sheet starts at the first row that is a heading
  if (headerIdx > 0) { const early = rows.slice(0, headerIdx).findIndex(isHeadingRow); if (early >= 0) headerIdx = early; }
  if (headerIdx < 0) {
    out.warnings.push({ code: 'no_header', message: 'No column headings found. Add a heading row (Name, Phone, Client…) and upload again.' });
    out.summary = { rows: 0, people: 0, trackers: 0, errors: 0, warnings: 0, unknownStatuses: [], clients: [], designations: [] };
    return out;
  }
  out.headerRow = headerIdx + 1;
  const { blocks, repeatRows } = findBlocks(rows, headerIdx);
  const now = opts.now instanceof Date ? opts.now : new Date();

  const unknownStatuses = new Map(); const clients = new Map(); const designations = new Map(); const stages = {};
  const seen = new Map(); // identity key -> first row number
  const seenTracker = new Set();
  let errors = 0; let warns = 0; let trackerCount = 0; let people = 0;

  blocks.forEach((blk, bi) => {
    const columns = buildColumns(rows, blk.headerIdx, opts, blk.end);
    const by = {}; columns.forEach((c) => { if (c.field) by[c.field] = c; });
    const fieldSet = new Set(Object.keys(by));
    const kind = kindOf(fieldSet);
    if (bi === 0) { out.columns = columns; out.kind = kind; }
    else if (kind === 'unknown') {
      out.warnings.push({ code: 'extra_table_skipped', message: `Row ${blk.headerIdx + 1} starts another table with headings we could not read, so its rows were left out.` });
      return;
    } else out.warnings.push({ code: 'extra_table', message: `Row ${blk.headerIdx + 1} starts another table with its own headings. It was read separately.` });

    // date order: one answer for the table, taken from every date column
    const dateCols = ['lineupDate', 'interviewDate', 'joiningDate'].map((f) => by[f]).filter(Boolean);
    const dateValues = dateCols.flatMap((c) => rows.slice(blk.headerIdx + 1, blk.end).map((r) => (r ? r[c.index] : null)));
    const det = opts.dateOrder ? { order: opts.dateOrder, certain: true } : N.detectDateOrder(dateValues);
    if (bi === 0) out.dateOrder = det;
    const order = det.order === 'mixed' ? 'dmy' : det.order;
    if (det.order === 'mixed') out.warnings.push({ code: 'mixed_date_order', message: 'Some dates are day-first and some month-first. Check the dates in the preview.' });
    // only worth asking when a written-out date really could be read two ways (real Excel dates are never ambiguous)
    else if (dateCols.length && !det.certain && N.countAmbiguousDates(dateValues) > 0) out.warnings.push({ code: 'date_order_assumed', message: 'Dates like 05/10/2026 could be 5 Oct or 10 May. Read as day-first. Change it if that is wrong.' });

    // one tab per day: the tab name stands in for a missing lineup-date column
    let sheetDate = null;
    if (bi === 0 && !by.lineupDate) {
      const d = N.parseDate(sheet.name, { order, now: opts.now });
      if (d.date) { out.sheetDate = d.date; sheetDate = d.date; }
    } else if (bi > 0) sheetDate = out.sheetDate && !by.lineupDate ? out.sheetDate : null;

    const cell = (row, f) => (by[f] ? row[by[f].index] : null);
    const extraCols = columns.filter((c) => !c.field && c.label);

    for (let r = blk.headerIdx + 1; r < blk.end; r += 1) {
      const row = rows[r];
      if (repeatRows.has(r)) continue;
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
        skills: N.text(cell(row, 'skills')) ? String(cell(row, 'skills')).split(/[,;|/]+/).map((x) => x.trim()).filter(Boolean).slice(0, 40) : [],
        sourceText: N.text(cell(row, 'source')),
      };
      // — pipeline —
      const dt = (f) => {
        const v = cell(row, f); if (N.isBlank(v)) return null;
        const p = N.parseDate(v, { order, now: opts.now });
        if (!p.date) issues.push({ level: 'warn', code: 'unparsed_date', message: `Could not read the date "${N.text(v)}"` });
        else if (!N.plausibleDate(p.date, now)) issues.push({ level: 'warn', code: 'odd_date', message: `The date ${p.date} is a long way from today. Check the year.` });
        return p.date;
      };
      const lineupDate = dt('lineupDate') || sheetDate || out.sheetDate || null;
      const interviewDate = dt('interviewDate');
      const joiningDate = dt('joiningDate');
      const interviewTime = N.parseTime(cell(row, 'interviewTime'));
      // Real trackers mix things in one column: a salary typed under Status, "Reached" typed under Recruiter,
      // statuses typed under Remarks. Sort each value by what it is rather than by the heading above it.
      const extraCustom = {};
      let statusText = N.text(cell(row, 'status'));
      let remarksText = N.text(cell(row, 'remarks'));
      let recruiterText = N.text(cell(row, 'recruiter'));
      const readsAsStatus = (t) => Boolean(t) && t.split(' ').length <= 4 && interpretStatus(t, opts.statusOverrides).matched !== null;
      if (statusText && N.salaryLike(cell(row, 'status')) && !readsAsStatus(statusText)) {
        if (!by.expectedCtc) extraCustom.expectedCtc = statusText;
        statusText = null;
      }
      if (recruiterText && readsAsStatus(recruiterText)) {
        if (!statusText) statusText = recruiterText;
        recruiterText = null;
      }
      if (by.remarks && by.remarks.statusToo && remarksText && !statusText) {
        if (N.salaryLike(remarksText)) { if (!by.expectedCtc) { extraCustom.expectedCtc = remarksText; remarksText = null; } }
        else if (readsAsStatus(remarksText)) statusText = remarksText;
      }
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
        lineupDate, interviewDate, interviewTime, joiningDate,
        statusText,
        stageKey: st ? st.stageKey : null, trackerStatus: st ? st.status : null, reason: st ? st.reason : null,
        remarks: remarksText,
        recruiterName: recruiterText,
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
      Object.entries(extraCustom).forEach(([k, v]) => { if (!custom[k]) custom[k] = v; });
      extraCols.forEach((c) => { const v = N.text(row[c.index]); if (v) custom[c.label] = v; });

      // — identity & repeats —
      // One person can have several lineups, and a rescheduled interview is a new date, not a repeat.
      // Only the same client, position and every date together make an exact repeat.
      const key = ph.phoneNormalized || (ph.phone ? `p:${String(ph.phone).replace(/\D/g, '').slice(-10)}` : null) || (em.email ? `e:${em.email}` : null);
      const tkey = `${key}|${(clientName || '').toLowerCase()}|${(designation || '').toLowerCase()}|${lineupDate || ''}|${interviewDate || ''}|${joiningDate || ''}`;
      let duplicateOfRow = null;
      if (key) {
        if (seen.has(key)) {
          duplicateOfRow = seen.get(key);
          if (hasTracker && seenTracker.has(tkey)) issues.push({ level: 'warn', code: 'duplicate_row', message: `Same candidate, client, position and dates as row ${duplicateOfRow}` });
          else issues.push({ level: 'info', code: 'same_candidate', message: `Same person as row ${duplicateOfRow} (one candidate, another lineup)` });
        } else { seen.set(key, r + 1); people += 1; }
        if (hasTracker) seenTracker.add(tkey);
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
  });

  out.summary = {
    rows: out.records.length, people, trackers: trackerCount, errors, warnings: warns, stages,
    unknownStatuses: [...unknownStatuses.values()].sort((a, b) => b.count - a.count),
    clients: [...clients.values()].sort((a, b) => b.count - a.count),
    designations: [...designations.values()].sort((a, b) => b.count - a.count),
  };
  if (blocks.length > 1) out.tables = blocks.map((b) => ({ headerRow: b.headerIdx + 1 }));
  return out;
}

/** Give every lineup in a sheet the same client (when the sheet has no client column of its own). */
function applyClient(sheet, clientName) {
  if (!clientName) return 0;
  let n = 0;
  sheet.records.forEach((rec) => { if (rec.tracker && !rec.tracker.clientName) { rec.tracker.clientName = clientName; n += 1; } });
  const m = new Map();
  sheet.records.forEach((rec) => { const c = rec.tracker && rec.tracker.clientName; if (c) { const k = c.toLowerCase(); m.set(k, { name: (m.get(k) || { name: c }).name, count: ((m.get(k) || {}).count || 0) + 1 }); } });
  sheet.summary.clients = [...m.values()].sort((a, b) => b.count - a.count);
  return n;
}

/**
 * opts.fileName, opts.clientMode ('none' | 'sheet' | 'name' | 'auto'), opts.clientName: see clientHint.js.
 * Returns { sheets, totals, client } where client says what was applied and what we would suggest.
 */
function analyseWorkbook(sheets, opts = {}) {
  const analysed = sheets.map((s) => analyseSheet(s, opts));
  const hasClientColumn = (s) => s.columns.some((c) => c.field === 'client');
  const needing = analysed.filter((s) => s.kind === 'lineup' && !hasClientColumn(s) && s.summary && s.summary.trackers > 0);
  const resolved = resolveClient({ mode: opts.clientMode, name: opts.clientName }, opts.fileName, analysed);
  const applied = [];
  if (resolved.mode !== 'none') needing.forEach((s) => { const name = clientForSheet(resolved, s.name); if (applyClient(s, name)) applied.push({ sheet: s.name, client: name }); });
  const sum = (f) => analysed.reduce((a, s) => a + (s.summary ? s.summary[f] || 0 : 0), 0);
  return {
    sheets: analysed,
    totals: { sheets: analysed.length, usableSheets: analysed.filter((s) => s.kind !== 'unknown').length, rows: sum('rows'), people: sum('people'), trackers: sum('trackers'), errors: sum('errors'), warnings: sum('warnings') },
    client: { ...resolved, needed: needing.length > 0, sheetNames: needing.map((s) => s.name), applied },
  };
}

module.exports = { analyseWorkbook, analyseSheet, findHeaderRow, buildColumns, findBlocks, applyClient };
