// Import data: the API calls and the small pure helpers behind the Import page.
// Kept free of React so the rules (limits, duplicates, per-file status) can be tested with node --test.
import { apiFetch } from './api.js';

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt';
const EXTENSIONS = ['.xlsx', '.xlsm', '.csv', '.tsv', '.txt'];

export const FIELD_OPTIONS = [
  ['candidateName', 'Candidate name'], ['firstName', 'First name'], ['lastName', 'Last name'], ['phone', 'Phone'], ['altPhone', 'Alternate phone'],
  ['email', 'Email'], ['client', 'Client'], ['designation', 'Position'], ['clientLocation', 'Job location'], ['location', 'Candidate location'],
  ['lineupDate', 'Lineup date'], ['interviewDate', 'Interview date'], ['joiningDate', 'Joining date'], ['status', 'Status'], ['remarks', 'Remarks'],
  ['recruiter', 'Recruiter'], ['experience', 'Experience'], ['currentCtc', 'Current CTC'], ['expectedCtc', 'Expected CTC'], ['noticePeriod', 'Notice period'],
  ['source', 'Source'], ['skills', 'Skills'], ['qualification', 'Qualification'], ['currentEmployer', 'Current employer'], ['resumeLink', 'Resume link'],
];
export const fieldLabel = (key) => (FIELD_OPTIONS.find(([k]) => k === key) || [])[1] || null;

// Where a status word the sheet uses should land. stageKey null keeps the person where they are.
export const STATUS_CHOICES = [
  { value: 'stay', label: 'Stay at current stage', answer: { stageKey: null, status: 'active' } },
  { value: 'hold', label: 'On hold', answer: { stageKey: null, status: 'on_hold' } },
  { value: 'lineup', label: 'Lined up', answer: { stageKey: 'lineup', status: 'active' } },
  { value: 'interview', label: 'In interview', answer: { stageKey: 'interview', status: 'active' } },
  { value: 'offer', label: 'Offered', answer: { stageKey: 'offer', status: 'active' } },
  { value: 'joined', label: 'Joined', answer: { stageKey: 'joined', status: 'placed' } },
  { value: 'rejected', label: 'Rejected', answer: { stageKey: null, status: 'rejected' } },
  { value: 'withdrawn', label: 'Dropped out', answer: { stageKey: null, status: 'withdrawn' } },
];

// Must match the backend's header normaliser: mapping answers are keyed by it.
export const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

export const formatBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i < 0 ? '' : String(name).slice(i).toLowerCase(); };

/**
 * Which of the picked files can be added. Returns { accepted, rejected: [{ name, reason }] }.
 * `current` is what is already in the list (counted against the limits).
 */
export function screenFiles(picked, current = []) {
  const accepted = []; const rejected = [];
  let count = current.length; let bytes = current.reduce((a, f) => a + (f.size || 0), 0);
  const seen = new Set(current.map((f) => `${f.name}|${f.size}|${f.lastModified ?? ''}`));
  for (const f of picked) {
    const id = `${f.name}|${f.size}|${f.lastModified ?? ''}`;
    if (!EXTENSIONS.includes(extOf(f.name))) { rejected.push({ name: f.name, reason: 'Use an Excel (.xlsx) or CSV file' }); continue; }
    if (extOf(f.name) === '.xls') { rejected.push({ name: f.name, reason: 'Save it as .xlsx first' }); continue; }
    if (seen.has(id)) { rejected.push({ name: f.name, reason: 'Already added' }); continue; }
    if (f.size > MAX_FILE_BYTES) { rejected.push({ name: f.name, reason: `Over ${MAX_FILE_BYTES / 1048576} MB` }); continue; }
    if (count >= MAX_FILES) { rejected.push({ name: f.name, reason: `Only ${MAX_FILES} files at a time` }); continue; }
    if (bytes + f.size > MAX_TOTAL_BYTES) { rejected.push({ name: f.name, reason: `Would pass ${MAX_TOTAL_BYTES / 1048576} MB in total` }); continue; }
    seen.add(id); count += 1; bytes += f.size; accepted.push(f);
  }
  return { accepted, rejected };
}

/** Ready / check / skipped for one analysed file, plus the one-line reason shown under its name. */
export function fileStatus(a) {
  if (!a) return { state: 'reading', note: 'Reading…' };
  if (a.error) return { state: 'skipped', note: a.error };
  if (a.duplicateOf) return { state: 'skipped', note: `Same file as ${a.duplicateOf}` };
  const t = a.totals || {};
  if (!t.rows) return { state: 'skipped', note: 'No candidate rows found' };
  const usable = (a.sheets || []).filter((s) => s.kind !== 'unknown');
  const skippedTabs = (a.sheets || []).length - usable.length;
  const toCheck = (a.sheets || []).reduce((n, s) => n + (s.columns || []).filter((c) => c.status === 'review').length, 0)
    + (a.sheets || []).reduce((n, s) => n + (((s.summary || {}).unknownStatuses) || []).length, 0);
  const base = `${plural((a.sheets || []).length, 'tab')} · ${plural(t.rows, 'row')}`;
  if (toCheck) return { state: 'check', note: `${base} · ${plural(toCheck, 'thing')} to check` };
  if (skippedTabs) return { state: 'check', note: `${base} · ${plural(skippedTabs, 'tab')} not used` };
  return { state: 'ready', note: base };
}

/** Totals across the files that will really be imported. */
export function totalsOf(entries) {
  const ok = entries.filter((e) => e.analysis && !e.analysis.error && !e.analysis.duplicateOf && (e.analysis.totals || {}).rows);
  return { files: ok.length, rows: ok.reduce((n, e) => n + e.analysis.totals.rows, 0), people: ok.reduce((n, e) => n + (e.analysis.totals.people || 0), 0) };
}

/** Status words nobody could place, merged across files, with the files that use each. */
export function unknownStatuses(entries) {
  const out = new Map();
  for (const e of entries) {
    if (!e.analysis || e.analysis.duplicateOf) continue;
    for (const s of e.analysis.sheets || []) for (const u of (s.summary || {}).unknownStatuses || []) {
      const cur = out.get(u.key) || { key: u.key, text: u.text, count: 0, files: new Set() };
      cur.count += u.count; cur.files.add(e.file.name); out.set(u.key, cur);
    }
  }
  return [...out.values()].map((u) => ({ ...u, files: [...u.files] })).sort((a, b) => b.count - a.count);
}

/** The dropdown answers -> what the API wants. */
export const statusOverridesFrom = (answers) => Object.fromEntries(Object.entries(answers)
  .map(([key, v]) => [key, (STATUS_CHOICES.find((c) => c.value === v) || {}).answer]).filter(([, a]) => a));
export const mappingOverridesFrom = (answers) => Object.fromEntries(Object.entries(answers).filter(([, v]) => v));

// ── API ─────────────────────────────────────────────────────────────────────
function fields(form, o) {
  if (o.dateOrder) form.append('dateOrder', o.dateOrder);
  if (o.defaultCountry) form.append('defaultCountry', o.defaultCountry);
  if (o.statusOverrides && Object.keys(o.statusOverrides).length) form.append('statusOverrides', JSON.stringify(o.statusOverrides));
  if (o.mappingOverrides && Object.keys(o.mappingOverrides).length) form.append('mappingOverrides', JSON.stringify(o.mappingOverrides));
}

export async function analyseFile(file, o = {}) {
  const form = new FormData(); form.append('file', file); fields(form, o);
  return (await apiFetch('/api/v1/data-import/analyse', { method: 'POST', body: form })).data;
}

export async function createPreview(files, teamId, o = {}) {
  const form = new FormData(); form.append('teamId', teamId);
  files.forEach((f) => form.append('files', f)); fields(form, o);
  return (await apiFetch('/api/v1/data-import/preview', { method: 'POST', body: form })).data;
}

export const getBatch = async (id) => (await apiFetch(`/api/v1/data-import/batches/${id}`)).data;
export const getRows = async (id, filter, limit = 50, page = 1) => (await apiFetch(`/api/v1/data-import/batches/${id}/rows?filter=${filter}&limit=${limit}&page=${page}`)).data;
export const decide = async (id, patch) => (await apiFetch(`/api/v1/data-import/batches/${id}/decisions`, { method: 'PATCH', body: patch })).data;
export const startCommit = async (id, body) => (await apiFetch(`/api/v1/data-import/batches/${id}/commit`, { method: 'POST', body })).data;
export const commitNext = async (id) => (await apiFetch(`/api/v1/data-import/batches/${id}/commit/next`, { method: 'POST', body: {} })).data;
export const undoBatch = async (id) => (await apiFetch(`/api/v1/data-import/batches/${id}/undo`, { method: 'POST', body: {} })).data;
export const discardBatch = (id) => apiFetch(`/api/v1/data-import/batches/${id}`, { method: 'DELETE' });

/** Call "next" until the batch is no longer importing; the last call finishes it. Needs startCommit first. */
export async function runCommit(id, started, onProgress, { signal } = {}) {
  let batch = started;
  while (batch.status === 'importing') {
    if (signal && signal.aborted) break;
    batch = await commitNext(id);
    if (onProgress) onProgress(batch.progress, batch);
  }
  return batch;
}

const csvCell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
/** Left-out rows as CSV text: where they were, who, and why. */
export function skippedCsv(rows, reasonOf) {
  const head = ['File and tab', 'Row', 'Name', 'Phone', 'Client', 'Why'];
  const lines = rows.map((r) => [r.sheetName, r.rowNumber, `${(r.data.candidate || {}).firstName || ''} ${(r.data.candidate || {}).lastName || ''}`.trim(),
    (r.data.candidate || {}).phone || '', (r.data.tracker || {}).clientName || '', reasonOf(r)].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n');
}
/** Every left-out row of a batch (rows the plan skips, plus rows that cannot be imported). */
export async function fetchLeftOut(id, cap = 1000) {
  const out = []; let total = 0;
  for (const filter of ['blocked', 'skipped']) {
    for (let page = 1; out.length < cap; page += 1) {
      const res = await getRows(id, filter, 200, page);
      if (page === 1) total += res.total;
      out.push(...res.rows.filter((r) => !out.some((o) => o.seq === r.seq)));
      if (res.rows.length < 200) break;
    }
  }
  return { rows: out, total: Math.max(total, out.length), complete: out.length >= total || out.length < cap };
}
