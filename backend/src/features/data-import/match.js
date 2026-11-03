/**
 * Matching: turn analysed rows into a plan against what already exists.
 * Pure — the service loads the catalog from the database and hands it in.
 *
 * buildPlan({ sheets, catalog, decisions, opts }) -> { rows, entities, summary }
 *
 * Principles
 *  - Exact matches are used. Near matches are only suggested: a wrong merge of two
 *    clients sends mail to the wrong people, a duplicate client is merely untidy.
 *  - Every default can be overridden by HR through `decisions`, keyed by entity.
 *  - Nothing is written here and nothing is guessed silently: each doubtful
 *    choice carries needsReview.
 */

const LEGAL = /\b(pvt|private|ltd|limited|llp|inc|incorporated|corp|corporation|co|company|plc)\b/g;
const CANONICAL_STAGES = ['applied', 'screening', 'lineup', 'turnup', 'interview', 'offer', 'joined'];
const LIVE = new Set(['active', 'on_hold']);

/** Spelling-insensitive key for company / place / role names. */
function nameKey(raw) {
  if (raw === null || raw === undefined) return '';
  const base = String(raw).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const stripped = base.replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
  return stripped || base;
}

const bigrams = (s) => { const t = s.replace(/\s+/g, ''); const out = new Map(); for (let i = 0; i < t.length - 1; i += 1) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
/** Dice coefficient on character bigrams, 0..1. */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a); const B = bigrams(b);
  let inter = 0; let total = 0;
  A.forEach((n, g) => { total += n; if (B.has(g)) inter += Math.min(n, B.get(g)); });
  B.forEach((n) => { total += n; });
  return total ? (2 * inter) / total : 0;
}

/** One name against a list of { id, key, label }: exact, near, or nothing. */
function matchName(key, options) {
  if (!key) return { type: 'none' };
  const exact = options.filter((o) => o.key === key);
  if (exact.length === 1) return { type: 'exact', id: exact[0].id, label: exact[0].label, score: 1 };
  if (exact.length > 1) return { type: 'ambiguous', options: exact.map((o) => ({ id: o.id, label: o.label })), score: 1 };
  const tokens = new Set(key.split(' '));
  let best = null;
  for (const o of options) {
    let score = similarity(key, o.key);
    const ot = o.key.split(' ');
    // "Reliance" vs "Reliance Retail": one side's words are all in the other
    const subset = (tokens.size <= ot.length ? [...tokens].every((t) => ot.includes(t)) : ot.every((t) => tokens.has(t))) && Math.min(tokens.size, ot.length) >= 1 && Math.max(key.length, o.key.length) >= 4;
    if (subset) score = Math.max(score, 0.8);
    if (score >= 0.8 && (!best || score > best.score)) best = { type: 'near', id: o.id, label: o.label, score: Math.round(score * 100) / 100 };
  }
  return best || { type: 'none' };
}

const todayOf = (now) => (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/** The stage we will actually use: the sheet's, or the nearest earlier one the template has. */
function resolveStage(stageKey, stages) {
  const have = new Map(stages.map((s) => [s.stageKey, s]));
  const first = [...stages].sort((a, b) => a.orderIndex - b.orderIndex)[0];
  if (!stageKey) return { stageKey: first ? first.stageKey : null, missing: false };
  if (have.has(stageKey)) return { stageKey, missing: false };
  const idx = CANONICAL_STAGES.indexOf(stageKey);
  for (let i = idx - 1; i >= 0; i -= 1) if (have.has(CANONICAL_STAGES[i])) return { stageKey: CANONICAL_STAGES[i], missing: true, wanted: stageKey };
  return { stageKey: first ? first.stageKey : null, missing: true, wanted: stageKey };
}

function buildPlan({ sheets, catalog, decisions = {}, opts = {} }) {
  const perm = { createClients: true, createLocations: true, createPositions: true, ...(catalog.permissions || {}) };
  const today = todayOf(opts.now);
  const D = { clients: {}, locations: {}, positions: {}, recruiters: {}, candidates: {}, rows: {}, ...decisions };

  // ── flatten, in file order ────────────────────────────────────────────────
  const flat = [];
  for (const s of sheets) for (const rec of s.records) flat.push({ sheetName: s.name, rec });
  flat.forEach((f, i) => { f.seq = i + 1; });

  // ── catalog indexes ───────────────────────────────────────────────────────
  const clientOpts = catalog.clients.map((c) => ({ id: c.id, key: nameKey(c.companyName), label: c.companyName }));
  const clientById = new Map(catalog.clients.map((c) => [c.id, c]));
  const users = catalog.users.map((u) => ({ id: u.id, key: nameKey(`${u.firstName} ${u.lastName}`), email: (u.email || '').toLowerCase(), label: `${u.firstName} ${u.lastName}`.trim() }));
  const byPhone = new Map(); const byEmail = new Map();
  catalog.candidates.forEach((c) => { if (c.phoneNormalized) byPhone.set(c.phoneNormalized, c); if (c.email) byEmail.set(c.email.toLowerCase(), c); });
  const hiddenPhones = new Set(catalog.hiddenPhones || []); const hiddenEmails = new Set((catalog.hiddenEmails || []).map((e) => e.toLowerCase()));
  const liveTags = new Set((catalog.liveTags || []).map((t) => `${t.candidateId}|${t.openPositionId}`));

  // ── people (one per real person, however many rows) ───────────────────────
  const people = new Map(); const keyToPerson = new Map();
  for (const f of flat) {
    const c = f.rec.candidate;
    const keys = [];
    if (c.phoneNormalized) keys.push(`p:${c.phoneNormalized}`); else if (c.phone) keys.push(`p:${last10(c.phone)}`);
    if (c.email) keys.push(`e:${c.email.toLowerCase()}`);
    let person = keys.map((k) => keyToPerson.get(k)).find(Boolean);
    if (!person) {
      person = { key: keys[0] || `r:${f.seq}`, fields: {}, rows: [], existing: null };
      people.set(person.key, person);
    }
    keys.forEach((k) => keyToPerson.set(k, person));
    Object.entries(c).forEach(([k, v]) => { if (v !== null && v !== '' && !(Array.isArray(v) && !v.length) && person.fields[k] === undefined) person.fields[k] = v; });
    person.rows.push(f.seq);
    f.person = person;
  }
  for (const p of people.values()) {
    const hit = (p.fields.phoneNormalized && byPhone.get(p.fields.phoneNormalized)) || (p.fields.email && byEmail.get(String(p.fields.email).toLowerCase())) || null;
    if (hit) p.existing = { id: hit.id, name: `${hit.firstName} ${hit.lastName || ''}`.trim(), email: hit.email, phone: hit.phone };
    const asked = D.candidates[p.key] && D.candidates[p.key].action;
    const valid = ['create', 'use_existing', 'fill_empty', 'skip'];
    p.action = asked && valid.includes(asked) && !((asked === 'use_existing' || asked === 'fill_empty') && !hit) ? asked : (hit ? 'use_existing' : 'create');
    // exists in a team this person cannot see: say nothing about who it is, and do not create a second copy
    const hid = !hit && ((p.fields.phoneNormalized && hiddenPhones.has(p.fields.phoneNormalized)) || (p.fields.email && hiddenEmails.has(String(p.fields.email).toLowerCase())));
    if (hid) { p.hidden = true; p.action = 'skip'; }
    p.nameMismatch = Boolean(hit && p.fields.firstName && similarity(nameKey(p.fields.firstName), nameKey(hit.firstName)) < 0.5 && nameKey(p.fields.firstName).split(' ')[0] !== nameKey(hit.firstName).split(' ')[0]);
  }

  // ── clients ───────────────────────────────────────────────────────────────
  const clients = new Map();
  const clientOf = (name) => {
    const key = nameKey(name); if (!key) return null;
    let e = clients.get(key);
    if (!e) {
      e = { key, names: new Set(), rows: 0, match: matchName(key, clientOpts) };
      clients.set(key, e);
    }
    e.names.add(name); e.rows += 1;
    return e;
  };
  flat.forEach((f) => { if (f.rec.tracker && f.rec.tracker.clientName) f.client = clientOf(f.rec.tracker.clientName); });
  for (const e of clients.values()) {
    const ask = D.clients[e.key];
    const m = e.match;
    let action; let clientId = null; let needsReview = false;
    if (ask && ask.action === 'use_existing' && clientById.has(ask.clientId)) { action = 'use_existing'; clientId = ask.clientId; }
    else if (ask && ask.action === 'create') action = 'create';
    else if (m.type === 'exact') { action = 'use_existing'; clientId = m.id; }
    else if (m.type === 'near' || m.type === 'ambiguous') { action = 'create'; needsReview = true; }
    else action = 'create';
    e.decision = { action, clientId };
    e.blocked = action === 'create' && !perm.createClients;
    e.needsReview = needsReview;
    e.label = [...e.names][0];
    e.matchedTo = clientId ? { id: clientId, name: clientById.get(clientId).companyName } : null;
  }

  // ── locations (within a client) ───────────────────────────────────────────
  const locations = new Map();
  flat.forEach((f) => {
    const t = f.rec.tracker; if (!t || !t.locationName || !f.client) return;
    const lk = nameKey(t.locationName); if (!lk) return;
    const key = `${f.client.key}|${lk}`;
    let e = locations.get(key);
    if (!e) {
      const existing = f.client.decision.clientId ? catalog.locations.filter((l) => l.clientId === f.client.decision.clientId) : [];
      const opts2 = existing.flatMap((l) => [{ id: l.id, key: nameKey(l.name), label: l.name }, ...(l.aliases || []).map((a) => ({ id: l.id, key: nameKey(a), label: l.name }))]);
      e = { key, clientKey: f.client.key, label: t.locationName, rows: 0, match: matchName(lk, opts2) };
      locations.set(key, e);
    }
    e.rows += 1; f.location = e;
  });
  const locById = new Map(catalog.locations.map((l) => [l.id, l]));
  for (const e of locations.values()) {
    const ask = D.locations[e.key]; const m = e.match;
    let action; let locationId = null; let needsReview = false;
    if (ask && ask.action === 'use_existing' && locById.has(ask.locationId)) { action = 'use_existing'; locationId = ask.locationId; }
    else if (ask && ask.action === 'create') action = 'create';
    else if (m.type === 'exact') { action = 'use_existing'; locationId = m.id; }
    else { action = 'create'; needsReview = m.type === 'near' || m.type === 'ambiguous'; }
    e.decision = { action, locationId };
    e.needsReview = needsReview;
    e.blocked = action === 'create' && !perm.createLocations;
    e.matchedTo = locationId ? { id: locationId, name: locById.get(locationId).name } : null;
  }

  // ── positions ─────────────────────────────────────────────────────────────
  const positions = new Map();
  const livePositions = catalog.positions.filter((p) => ['open', 'on_hold'].includes(p.status));
  flat.forEach((f) => {
    const t = f.rec.tracker;
    if (!t || !t.designation || !f.client) return;
    const dk = nameKey(t.designation); const lk = nameKey(t.locationName || '');
    const key = `${f.client.key}|${dk}|${lk}`;
    let e = positions.get(key);
    if (!e) {
      e = { key, clientKey: f.client.key, designation: t.designation, location: t.locationName || null, rows: 0, match: { type: 'none' }, options: [] };
      const cid = f.client.decision.clientId;
      if (cid) {
        const same = livePositions.filter((p) => p.clientId === cid && nameKey(p.designation) === dk);
        const exactLoc = same.filter((p) => nameKey(p.location || '') === lk);
        if (exactLoc.length === 1) e.match = { type: 'exact', id: exactLoc[0].id, label: `${exactLoc[0].designation}${exactLoc[0].location ? ` – ${exactLoc[0].location}` : ''}` };
        else if (!lk && same.length === 1) e.match = { type: 'near', id: same[0].id, label: `${same[0].designation}${same[0].location ? ` – ${same[0].location}` : ''}`, score: 0.9 };
        else if (same.length) e.options = same.map((p) => ({ id: p.id, label: `${p.designation}${p.location ? ` – ${p.location}` : ''}` }));
        if (exactLoc.length > 1) e.options = exactLoc.map((p) => ({ id: p.id, label: `${p.designation}${p.location ? ` – ${p.location}` : ''}` }));
      }
      positions.set(key, e);
    }
    e.rows += 1; f.position = e;
  });
  const posById = new Map(catalog.positions.map((p) => [p.id, p]));
  for (const e of positions.values()) {
    const ask = D.positions[e.key]; const m = e.match;
    let action; let positionId = null; let needsReview = false;
    if (ask && ask.action === 'use_existing' && posById.has(ask.positionId)) { action = 'use_existing'; positionId = ask.positionId; }
    else if (ask && ask.action === 'none') action = 'none';
    else if (ask && ask.action === 'create') action = 'create';
    else if (m.type === 'exact') { action = 'use_existing'; positionId = m.id; }
    else { action = 'create'; needsReview = m.type === 'near' || e.options.length > 0; }
    e.decision = { action, positionId };
    e.needsReview = needsReview;
    e.blocked = action === 'create' && !perm.createPositions;
    const clientEntity = clients.get(e.clientKey);
    if (clientEntity && clientEntity.blocked && action === 'create') e.blocked = true;
    e.matchedTo = positionId ? { id: positionId, label: (posById.get(positionId) || {}).designation } : null;
  }

  // ── recruiters ────────────────────────────────────────────────────────────
  const recruiters = new Map();
  flat.forEach((f) => {
    const n = f.rec.tracker && f.rec.tracker.recruiterName; const key = nameKey(n); if (!key) return;
    let e = recruiters.get(key);
    if (!e) {
      const byName = users.filter((u) => u.key === key); const byMail = users.filter((u) => u.email && u.email === String(n).toLowerCase().trim());
      const hit = byMail.length === 1 ? byMail : byName;
      e = { key, label: n, rows: 0, match: hit.length === 1 ? { type: 'exact', id: hit[0].id, label: hit[0].label } : { type: hit.length > 1 ? 'ambiguous' : 'none' } };
      recruiters.set(key, e);
    }
    e.rows += 1; f.recruiter = e;
  });
  for (const e of recruiters.values()) {
    const ask = D.recruiters[e.key];
    const uid = ask && 'userId' in ask ? ask.userId : (e.match.type === 'exact' ? e.match.id : null);
    e.decision = { userId: users.some((u) => u.id === uid) ? uid : null };
  }

  // ── rows ──────────────────────────────────────────────────────────────────
  const seenLive = new Set();
  const rows = [];
  const stats = { import: 0, skip: 0, blocked: 0, historic: 0, create: 0, trackerSkip: 0, stages: {}, errors: 0, warnings: 0 };
  for (const f of flat) {
    const { rec, person } = f;
    const issues = rec.issues.slice();
    const add = (level, code, message) => issues.push({ level, code, message });
    const t = rec.tracker;
    const plan = { action: 'import', candidateKey: person.key, candidateAction: person.action };
    const excluded = D.rows[`${f.sheetName}:${rec.row}`] && D.rows[`${f.sheetName}:${rec.row}`].action === 'skip';

    if (person.hidden) add('warn', 'exists_elsewhere', 'This candidate is already in your organisation\'s database, in a team you cannot see. Skipped to avoid a second copy.');
    if (person.existing) { plan.existingCandidate = person.existing; if (person.nameMismatch) add('warn', 'name_mismatch', `Phone/email belongs to "${person.existing.name}" already in your database`); }
    if (rec.blocking && !person.existing) plan.action = 'blocked';
    if (person.action === 'skip') plan.action = 'skip';
    if (excluded) plan.action = 'skip';

    if (t) {
      plan.clientKey = f.client ? f.client.key : null;
      plan.locationKey = f.location ? f.location.key : null;
      plan.positionKey = f.position ? f.position.key : null;
      plan.recruiterKey = f.recruiter ? f.recruiter.key : null;
      if (f.client && f.client.blocked) add('error', 'client_not_allowed', `"${f.client.label}" is a new client and you don't have permission to create clients. Ask a manager, or pick an existing client.`);
      if (f.client && f.client.needsReview) add('info', 'client_review', `"${f.client.label}" looks like "${f.client.match.label || 'an existing client'}". Check which one is meant.`);
      if (f.position && f.position.blocked && !(f.client && f.client.blocked)) add('error', 'position_not_allowed', 'This needs a new open position and you don\'t have permission to create one.');
      if (f.client && f.position && f.position.decision.action === 'none') add('info', 'no_position', 'Imported without an open position');
      if (!f.position && (t.clientName || t.designation)) add('info', 'no_position', t.clientName && !t.designation ? 'No position on this row, so no open position is linked' : 'No client on this row, so no open position is linked');
      const stage = resolveStage(t.stageKey, catalog.stages);
      if (stage.missing) add('warn', 'stage_missing', `Your pipeline has no "${stage.wanted}" stage; placed at "${stage.stageKey}" instead`);
      const status = t.trackerStatus || 'active';
      const historic = status === 'placed' || [t.lineupDate, t.interviewDate, t.joiningDate].filter(Boolean).every((d) => d < today) && [t.lineupDate, t.interviewDate, t.joiningDate].some(Boolean);
      const assigned = f.recruiter ? f.recruiter.decision.userId : null;
      let action = 'create'; let skipReason = null;
      const posId = f.position && f.position.decision.action === 'use_existing' ? f.position.decision.positionId : null;
      if (!f.position || f.position.decision.action === 'none') { /* tracker without a position is allowed */ }
      if (issues.some((i) => i.code === 'duplicate_row')) { action = 'skip'; skipReason = 'duplicate_row'; }
      if (LIVE.has(status) && action === 'create') {
        const pk = f.position && f.position.decision.action !== 'none' ? `${person.key}|${f.position.key}` : null;
        if (pk) {
          if (seenLive.has(pk)) { action = 'skip'; skipReason = 'duplicate_live'; add('warn', 'duplicate_live', 'This person is already live for this position earlier in the file'); }
          else seenLive.add(pk);
        }
        if (posId && person.existing && liveTags.has(`${person.existing.id}|${posId}`)) {
          action = 'skip'; skipReason = 'already_live'; add('warn', 'already_live', 'This person is already live for this position in your tracker');
        }
      }
      plan.tracker = { action, skipReason, stageKey: stage.stageKey, status, reason: t.reason || null, historic, assignedHr: assigned, lineupDate: t.lineupDate, interviewDate: t.interviewDate, joiningDate: t.joiningDate, remarks: t.remarks };
      if (issues.some((i) => i.level === 'error') && plan.action === 'import') plan.action = 'blocked';
      if (plan.action === 'import') { if (action === 'create') { stats.create += 1; if (historic) stats.historic += 1; stats.stages[stage.stageKey] = (stats.stages[stage.stageKey] || 0) + 1; } else stats.trackerSkip += 1; }
    } else if (issues.some((i) => i.level === 'error') && plan.action === 'import') plan.action = 'blocked';

    stats[plan.action] += 1;
    stats.errors += issues.filter((i) => i.level === 'error').length;
    stats.warnings += issues.filter((i) => i.level === 'warn').length;
    rows.push({ seq: f.seq, sheetName: f.sheetName, rowNumber: rec.row, data: { candidate: rec.candidate, tracker: rec.tracker, custom: rec.custom }, issues, plan });
  }

  const list = (m, fn) => [...m.values()].map(fn).sort((a, b) => b.rows - a.rows);
  const entities = {
    clients: list(clients, (e) => ({ key: e.key, label: e.label, names: [...e.names], rows: e.rows, match: e.match, decision: e.decision, matchedTo: e.matchedTo, needsReview: e.needsReview, blocked: e.blocked })),
    locations: list(locations, (e) => ({ key: e.key, clientKey: e.clientKey, label: e.label, rows: e.rows, match: e.match, decision: e.decision, matchedTo: e.matchedTo, needsReview: e.needsReview, blocked: e.blocked })),
    positions: list(positions, (e) => ({ key: e.key, clientKey: e.clientKey, designation: e.designation, location: e.location, rows: e.rows, match: e.match, options: e.options, decision: e.decision, matchedTo: e.matchedTo, needsReview: e.needsReview, blocked: e.blocked })),
    recruiters: list(recruiters, (e) => ({ key: e.key, label: e.label, rows: e.rows, match: e.match, decision: e.decision })),
  };
  const ppl = [...people.values()];
  const count = (arr, fn) => arr.filter(fn).length;
  const summary = {
    rows: { total: rows.length, import: stats.import, skip: stats.skip, blocked: stats.blocked },
    candidates: { unique: ppl.length, new: count(ppl, (p) => p.action === 'create'), existing: count(ppl, (p) => p.existing), skipped: count(ppl, (p) => p.action === 'skip') },
    clients: { new: count(entities.clients, (e) => e.decision.action === 'create'), matched: count(entities.clients, (e) => e.decision.action === 'use_existing'), needsReview: count(entities.clients, (e) => e.needsReview), blocked: count(entities.clients, (e) => e.blocked) },
    locations: { new: count(entities.locations, (e) => e.decision.action === 'create'), matched: count(entities.locations, (e) => e.decision.action === 'use_existing') },
    positions: { new: count(entities.positions, (e) => e.decision.action === 'create'), matched: count(entities.positions, (e) => e.decision.action === 'use_existing'), needsReview: count(entities.positions, (e) => e.needsReview) },
    recruiters: { matched: count(entities.recruiters, (e) => e.decision.userId), unmatched: count(entities.recruiters, (e) => !e.decision.userId) },
    trackers: { create: stats.create, skip: stats.trackerSkip, historic: stats.historic },
    stages: stats.stages,
    issues: { errors: stats.errors, warnings: stats.warnings },
  };
  // candidates that will really be added to the database (what plan limits count)
  summary.newCandidateRows = ppl.filter((p) => p.action === 'create' && p.rows.some((s) => rows[s - 1].plan.action === 'import')).length;
  return { rows, entities, summary };
}

module.exports = { buildPlan, nameKey, similarity, matchName, resolveStage, CANONICAL_STAGES };
