import { useCallback, useEffect, useRef, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorNote, Loading, PageHeader } from '@/components/common';
import { FilesStep } from '../components/import/FilesStep';
import { ReviewStep } from '../components/import/ReviewStep';
import { ImportStep } from '../components/import/ImportStep';
import { useAuth } from '../context/AuthContext';
import { apiFetch, ApiError } from '../lib/api';
import {
  analyseFile, createPreview, decide, discardBatch, fetchLeftOut, mappingOverridesFrom, runCommit, screenFiles, skippedCsv, startCommit, statusOverridesFrom, undoBatch,
} from '../lib/dataImport';
import { cn } from '@/lib/utils';

const STEPS = ['Check files', 'Review', 'Import'];
const msg = (e) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
let nextId = 1;

function Stepper({ step }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-label="Progress">
      {STEPS.map((l, i) => (
        <li key={l} className="flex items-center gap-3" aria-current={i === step ? 'step' : undefined}>
          <span className={cn(i === step ? 'font-semibold' : i < step ? 'font-semibold text-primary' : 'text-muted-foreground')}>{i + 1} {l}</span>
          {i < STEPS.length - 1 && <span className="text-muted-foreground" aria-hidden>›</span>}
        </li>
      ))}
    </ol>
  );
}

const whyOf = (r) => { const i = (r.issues || []).find((x) => x.level === 'error') || (r.issues || []).find((x) => x.level === 'warn'); return i ? i.message : (r.plan && r.plan.action === 'blocked' ? 'Cannot be imported' : 'Left out'); };

export function ImportPage() {
  const auth = useAuth();
  const [teams, setTeams] = useState(null);
  const [teamId, setTeamId] = useState('');
  const [entries, setEntries] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [dateOrder, setDateOrder] = useState('');
  const [statusAnswers, setStatusAnswers] = useState({});
  const [mappingAnswers, setMappingAnswers] = useState({});
  const [step, setStep] = useState(0);
  const [batch, setBatch] = useState(null);
  const [skipped, setSkipped] = useState({ rows: [], total: 0, complete: true });
  const [choices, setChoices] = useState({ clients: {}, positions: {} });
  const [alreadyMailed, setAlreadyMailed] = useState(false);
  const [skipBlocked, setSkipBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [undone, setUndone] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const entriesRef = useRef([]); const run = useRef(0);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  useEffect(() => {
    apiFetch('/api/v1/teams').then((res) => {
      let list = res.data.teams || [];
      if (!auth.isOrgAdmin && (auth.managedTeamIds || []).length) list = list.filter((t) => auth.managedTeamIds.includes(t.id));
      setTeams(list); setTeamId((cur) => cur || (list[0] ? list[0].id : ''));
    }).catch((e) => { setTeams([]); setError(msg(e)); });
  }, [auth.isOrgAdmin, auth.managedTeamIds]);

  const opts = useCallback((over = {}) => ({
    dateOrder: (over.dateOrder ?? dateOrder) || undefined,
    statusOverrides: statusOverridesFrom(over.statusAnswers ?? statusAnswers),
    mappingOverrides: mappingOverridesFrom(over.mappingAnswers ?? mappingAnswers),
  }), [dateOrder, statusAnswers, mappingAnswers]);

  // Read the given entries in order; the same file twice counts once. A newer run cancels an older one.
  const analyseAll = useCallback(async (list, o) => {
    const mine = ++run.current; const seen = new Map();
    for (const e of list) {
      if (run.current !== mine) return;
      let analysis;
      try {
        const a = await analyseFile(e.file, o);
        analysis = seen.has(a.fileHash) ? { duplicateOf: seen.get(a.fileHash) } : a;
        if (!seen.has(a.fileHash)) seen.set(a.fileHash, e.file.name);
      } catch (err) { analysis = { error: msg(err) }; }
      if (run.current !== mine) return;
      setEntries((cur) => cur.map((x) => (x.id === e.id ? { ...x, analysis } : x)));
    }
  }, []);

  const onAdd = (picked) => {
    const { accepted, rejected: bad } = screenFiles(picked, entriesRef.current.map((e) => e.file));
    setRejected(bad); setError(null);
    if (!accepted.length) return;
    const fresh = accepted.map((file) => ({ id: nextId++, file, analysis: undefined }));
    const all = [...entriesRef.current, ...fresh];
    setEntries(all); entriesRef.current = all;
    analyseAll(all.map((e) => (fresh.includes(e) ? e : { ...e })), opts());
  };
  const reanalyse = (over) => { setEntries((cur) => cur.map((e) => ({ ...e }))); analyseAll(entriesRef.current, opts(over)); };
  const onRemove = (id) => { const rest = entriesRef.current.filter((e) => e.id !== id); setEntries(rest); entriesRef.current = rest; analyseAll(rest, opts()); };
  const onDateOrder = (v) => { setDateOrder(v); reanalyse({ dateOrder: v }); };
  const onStatus = (key, v) => { const next = { ...statusAnswers, [key]: v }; setStatusAnswers(next); reanalyse({ statusAnswers: next }); };
  const onMap = (key, v) => { const next = { ...mappingAnswers }; if (v) next[key] = v; else delete next[key]; setMappingAnswers(next); reanalyse({ mappingAnswers: next }); };

  const loadSkipped = async (id) => { try { const r = await fetchLeftOut(id); setSkipped((s) => ({ ...s, rows: r.rows, total: r.total, complete: r.complete })); } catch { /* the list is a convenience */ } };

  const onContinue = async () => {
    setBusy(true); setError(null);
    try {
      const use = entriesRef.current.filter((e) => e.analysis && !e.analysis.error && !e.analysis.duplicateOf && (e.analysis.totals || {}).rows).map((e) => e.file);
      if (batch) { try { await discardBatch(batch.id); } catch { /* it expires on its own */ } }
      const b = await createPreview(use, teamId, opts());
      setBatch(b); setChoices({ clients: {}, positions: {} }); setSkipBlocked(false); setAlreadyMailed(false);
      await loadSkipped(b.id); setStep(1);
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  const onChoose = async (group, key, value) => {
    setChoices((c) => ({ ...c, [group]: { ...c[group], [key]: value } })); setError(null);
    let entry = null;
    if (value === 'create') entry = { action: 'create' };
    else if (value === 'none') entry = { action: 'none' };
    else if (value.startsWith('use:')) entry = group === 'clients' ? { action: 'use_existing', clientId: value.slice(4) } : { action: 'use_existing', positionId: value.slice(4) };
    try {
      const res = await decide(batch.id, { [group]: { [key]: entry } });
      setBatch((prev) => ({ ...res, files: prev.files, previouslyImported: prev.previouslyImported }));
      loadSkipped(batch.id);
    } catch (e) { setError(msg(e)); }
  };

  const download = async () => {
    try {
      const r = await fetchLeftOut(batch.id);
      const blob = new Blob([skippedCsv(r.rows, whyOf)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'left-out-rows.csv'; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setError(msg(e)); }
  };

  const onImport = async () => {
    setBusy(true); setError(null);
    try {
      const body = { options: { alreadyMailed } }; if (skipBlocked) body.skipBlocked = true;
      const started = await startCommit(batch.id, body);
      setBatch((prev) => ({ ...started, files: prev.files })); setProgress(started.progress); setStep(2); setBusy(false);
      const done = await runCommit(batch.id, started, (p) => setProgress(p));
      setBatch((prev) => ({ ...done, files: prev.files }));
    } catch (e) { setError(msg(e)); setBusy(false); }
  };

  const onUndo = async () => {
    setUndoing(true); setError(null);
    try { setUndone(await undoBatch(batch.id)); } catch (e) { setError(msg(e)); } finally { setUndoing(false); }
  };

  const again = () => {
    setEntries([]); entriesRef.current = []; setRejected([]); setStatusAnswers({}); setMappingAnswers({}); setBatch(null); setUndone(null); setProgress(null);
    setSkipped({ rows: [], total: 0, complete: true }); setError(null); setStep(0);
  };

  return (
    <AppLayout>
      <PageHeader title="Import data" subtitle="Bring your existing lineup sheets into HireTracker. Nothing is saved until you start the import." />
      <div className="max-w-4xl">
        <Stepper step={step} />
        {teams === null ? <Loading /> : (
          <>
            {step === 0 && (
              <FilesStep entries={entries} rejected={rejected} teams={teams} teamId={teamId} onTeam={setTeamId} dateOrder={dateOrder} onDateOrder={onDateOrder}
                statusAnswers={statusAnswers} onStatus={onStatus} mappingAnswers={mappingAnswers} onMap={onMap} onAdd={onAdd} onRemove={onRemove}
                onContinue={onContinue} busy={busy} error={error} />
            )}
            {step === 1 && batch && (
              <ReviewStep batch={batch} skipped={{ ...skipped, onDownload: download }} choices={choices} onChoose={onChoose} alreadyMailed={alreadyMailed} onMailed={setAlreadyMailed}
                skipBlocked={skipBlocked} onSkipBlocked={setSkipBlocked} onBack={() => { setStep(0); setError(null); }} onImport={onImport} busy={busy} error={error} />
            )}
            {step === 2 && batch && (
              <ImportStep batch={batch} progress={progress} undone={undone} onUndo={onUndo} undoing={undoing} onAgain={again} skippedCount={skipped.total} onDownload={download} error={error} />
            )}
            {step !== 0 && !batch && error && <ErrorNote>{error}</ErrorNote>}
          </>
        )}
      </div>
    </AppLayout>
  );
}
