import { useEffect, useMemo, useState } from 'react';
import { MapPin, Plus, UserPlus, ListChecks, Megaphone } from 'lucide-react';
import { Chips, EmptyState, ErrorNote, Loading, Sheet, StatusPill, Bar, Field, Notice, Fab } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useAuth } from '../../context/AuthContext';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { can } from '../../lib/roles';
import { CandidatePicker } from './CandidatePicker';
import { JobPostingsSection, PostJobSheet } from './JobPostingsSection';

const STATUS_CHIPS = [
  { key: 'open', label: 'Open', empty: 'No open positions' },
  { key: 'on_hold', label: 'On hold', empty: 'No positions on hold' },
  { key: 'filled', label: 'Filled', empty: 'No filled positions' },
  { key: 'cancelled', label: 'Cancelled', empty: 'No cancelled positions' },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Open positions: the demand HR is working, with who's tagged to each. */
export function PositionsTab({ scope, onViewPipeline }) {
  const { roles } = useAuth();
  const { myTeams, positions, positionsLoading, positionsError, reloadPositions } = scope;
  const canWrite = can(roles, 'open_positions', 'write');
  const canTag = can(roles, 'trackers', 'write');
  const canPost = can(roles, 'job_postings', 'write');
  const jobs = useFetch('/api/v1/job-postings');

  const [status, setStatus] = useState('open');
  const [newOpen, setNewOpen] = useState(false);
  const [taggingFor, setTaggingFor] = useState(null);
  const [postFor, setPostFor] = useState(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const chips = useMemo(() => STATUS_CHIPS.map((c) => ({ ...c, count: positions.filter((p) => p.status === c.key).length })), [positions]);
  const visible = positions.filter((p) => p.status === status);
  const emptyTitle = STATUS_CHIPS.find((c) => c.key === status).empty;

  async function setPositionStatus(p, next) {
    setBusyId(p.id);
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/open-positions/${p.id}`, { method: 'PATCH', body: { status: next } });
      await reloadPositions();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not update this position.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Chips items={chips} value={status} onChange={setStatus} className="mb-4" />
      <ErrorNote onRetry={reloadPositions}>{positionsError}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {notice && <Notice tone="good" className="mb-4">{notice}</Notice>}
      {positionsLoading && <Loading />}
      {!positionsLoading && visible.length === 0 && (
        <EmptyState
          title={emptyTitle}
          body={status === 'open' && canWrite ? 'Create a position, then tag candidates to it.' : undefined}
          action={status === 'open' && canWrite && myTeams.length > 0 ? <Button onClick={() => setNewOpen(true)}><Plus /> New position</Button> : undefined}
        />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((p) => {
          const busy = busyId === p.id;
          const full = p.status === 'open' && p.filledCount >= p.vacancies;
          return (
            <Card key={p.id} className="gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.designation}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.clientName || 'Internal hire'}</div>
                </div>
                <StatusPill status={p.status} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {p.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{p.location}</span>}
                {p.experienceRequired && <span>{p.experienceRequired}</span>}
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{p.filledCount} of {plural(p.vacancies, 'vacancy', 'vacancies')} filled</span>
                  <span>{p.activeCount} in pipeline</span>
                </div>
                <Bar value={p.filledCount} max={p.vacancies} label={`${p.designation}: ${p.filledCount} of ${p.vacancies} filled`} />
              </div>
              {full && canWrite && (
                <Notice tone="good" actions={<Button size="sm" disabled={busy} onClick={() => setPositionStatus(p, 'filled')}>Mark as filled</Button>}>
                  All {plural(p.vacancies, 'vacancy', 'vacancies')} filled.
                </Notice>
              )}
              <div className="flex flex-wrap gap-2">
                {p.status === 'open' && canTag && <Button className="flex-1" onClick={() => { setActionError(null); setTaggingFor(p); }}><UserPlus /> Tag candidates</Button>}
                <Button variant="outline" className="flex-1" onClick={() => onViewPipeline(p.id)}><ListChecks /> View pipeline</Button>
              </div>
              <div className="flex flex-wrap gap-x-1">
                {canPost && p.status === 'open' && <Button variant="ghost" size="sm" onClick={() => setPostFor(p)}><Megaphone /> Post job</Button>}
                {canWrite && p.status === 'open' && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPositionStatus(p, 'on_hold')}>Put on hold</Button>}
                {canWrite && p.status === 'open' && !full && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPositionStatus(p, 'filled')}>Mark as filled</Button>}
                {canWrite && p.status === 'open' && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPositionStatus(p, 'cancelled')}>Cancel position</Button>}
                {canWrite && p.status !== 'open' && <Button variant="outline" size="sm" disabled={busy} onClick={() => setPositionStatus(p, 'open')}>Reopen</Button>}
              </div>
            </Card>
          );
        })}
      </div>

      {canWrite && myTeams.length > 0 && <Fab icon={Plus} onClick={() => setNewOpen(true)}>New position</Fab>}

      <JobPostingsSection jobs={jobs} positions={positions} open={jobsOpen} onToggle={() => setJobsOpen((o) => !o)} />

      <NewPositionSheet open={newOpen} onClose={() => setNewOpen(false)} teams={myTeams} onCreated={() => { setNewOpen(false); setStatus('open'); reloadPositions(); }} />
      <TagCandidatesSheet position={taggingFor} onClose={() => setTaggingFor(null)}
        onDone={(summary) => { setTaggingFor(null); setNotice(summary); reloadPositions(); }} />
      <PostJobSheet position={postFor} onClose={() => setPostFor(null)}
        onCreated={(p) => { setPostFor(null); setJobsOpen(true); jobs.reload(); setNotice(`Draft posting created for ${p.designation}. Publish it below when you're ready.`); }} />
    </>
  );
}

function TagCandidatesSheet({ position, onClose, onDone }) {
  const live = useFetch(position ? `/api/v1/trackers?openPositionId=${position.id}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [partial, setPartial] = useState(null);
  useEffect(() => { setError(null); setPartial(null); }, [position]);

  const excludeIds = (live.data?.trackers || []).filter((t) => ['active', 'on_hold'].includes(t.status)).map((t) => t.candidateId);

  async function confirm(ids) {
    setBusy(true);
    setError(null);
    setPartial(null);
    try {
      const res = await apiFetch('/api/v1/trackers/tag', { method: 'POST', body: { teamId: position.teamId, openPositionId: position.id, candidateIds: ids } });
      const { tagged, skipped, failed } = res.data;
      const skippedNote = skipped.length ? ` ${plural(skipped.length, 'was', 'were')} already on this position.` : '';
      if (failed.length === 0) {
        onDone(`Tagged ${plural(tagged.length, 'candidate', 'candidates')} to ${position.designation}.${skippedNote}`);
      } else {
        // Keep the sheet open so HR can see which ones didn't go through.
        live.reload();
        setPartial(`Tagged ${tagged.length}. Couldn't tag ${failed.length}: ${failed[0].message}.${skippedNote}`);
      }
    } catch (err) {
      setError(errorMessage(err, "Couldn't tag these candidates. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CandidatePicker
      open={!!position}
      onClose={onClose}
      title={`Tag to ${position?.designation || ''}`}
      excludeIds={excludeIds}
      busy={busy}
      error={error}
      footer={partial && <Notice tone="warn" className="mb-4">{partial}</Notice>}
      onConfirm={confirm}
    />
  );
}

function NewPositionSheet({ open, onClose, teams, onCreated }) {
  const EMPTY = { teamId: '', clientId: '', designation: '', location: '', experienceRequired: '', vacancies: '1' };
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setForm({ ...EMPTY, teamId: teams[0]?.id || '' }); setError(null); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const clients = useFetch(open && form.teamId ? `/api/v1/clients?teamId=${form.teamId}` : null);
  const update = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/open-positions', {
        method: 'POST',
        body: {
          teamId: form.teamId,
          clientId: form.clientId || undefined,
          designation: form.designation.trim(),
          location: form.location.trim() || undefined,
          experienceRequired: form.experienceRequired.trim() || undefined,
          vacancies: Math.max(1, parseInt(form.vacancies, 10) || 1),
        },
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err, 'Could not create the position.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New position">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {teams.length > 1 && (
          <Field label="Team" htmlFor="np-team">
            <NativeSelect id="np-team" value={form.teamId} onChange={(e) => setForm((s) => ({ ...s, teamId: e.target.value, clientId: '' }))}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
          </Field>
        )}
        <Field label="Client" htmlFor="np-client">
          <NativeSelect id="np-client" value={form.clientId} onChange={update('clientId')}>
            <option value="">Internal hire (no client)</option>
            {(clients.data?.clients || []).map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Position" htmlFor="np-title"><Input id="np-title" value={form.designation} onChange={update('designation')} placeholder="e.g. Sales Executive" required autoFocus autoComplete="off" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Location" htmlFor="np-loc"><Input id="np-loc" value={form.location} onChange={update('location')} autoComplete="off" /></Field>
          <Field label="Vacancies" htmlFor="np-vac"><Input id="np-vac" type="number" inputMode="numeric" min={1} value={form.vacancies} onChange={update('vacancies')} /></Field>
        </div>
        <Field label="Experience (optional)" htmlFor="np-exp"><Input id="np-exp" value={form.experienceRequired} onChange={update('experienceRequired')} placeholder="e.g. 2–4 years" autoComplete="off" /></Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" size="lg" disabled={busy || !form.teamId || !form.designation.trim()}>{busy ? 'Creating…' : 'Create position'}</Button>
      </form>
    </Sheet>
  );
}
