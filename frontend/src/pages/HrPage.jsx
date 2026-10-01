import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Plus, Pause, Play, X, ArrowRight, Search, Mail, CalendarClock } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../context/AuthContext';
import { useFetch, errorMessage } from '../hooks/useFetch';
import { apiFetch, ApiError } from '../lib/api';
import { can } from '../lib/roles';
import { PageHeader, Chips, ErrorNote, Loading, EmptyState, Sheet, Avatar, StatusPill } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { relativeTime, shortDate, fullName } from '../lib/format';

const COUNTRIES = [['IN', 'India +91'], ['US', 'United States +1'], ['GB', 'United Kingdom +44'], ['AE', 'UAE +971'], ['SG', 'Singapore +65'], ['CA', 'Canada +1'], ['AU', 'Australia +61']];
const TABS = [{ key: 'pipeline', label: 'Pipeline' }, { key: 'candidates', label: 'Candidates' }, { key: 'jobs', label: 'Jobs' }];
const CLOSED = ['rejected', 'withdrawn', 'placed'];

/**
 * HR workbench — phone-first. The job of this screen is "who do I need to
 * move or call next": a stage filter, one card per candidate, and the
 * single most likely next action (advance) as the biggest button.
 */
export function HrPage() {
  const auth = useAuth();
  const [tab, setTab] = useState('pipeline');

  return (
    <AppLayout>
      <PageHeader
        title="Pipeline"
        subtitle={`Hi ${auth.user.firstName} — here's what needs you today.`}
        action={<Link to="/hr/classic" className="text-xs text-muted-foreground underline underline-offset-4">Classic view</Link>}
      />
      <Chips items={TABS} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'candidates' && <CandidatesTab />}
      {tab === 'jobs' && <JobsTab />}
    </AppLayout>
  );
}

// ── Pipeline ─────────────────────────────────────────────────────────────
function PipelineTab() {
  const auth = useAuth();
  const { user, roles } = auth;
  const trackers = useFetch('/api/v1/trackers');
  const positions = useFetch('/api/v1/open-positions');
  const teams = useFetch('/api/v1/teams');
  const workflows = useFetch('/api/v1/workflows');
  const org = useFetch('/api/v1/organizations/me');

  const [stagesByTemplate, setStagesByTemplate] = useState({});
  const [scope, setScope] = useState('mine');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  // Stage lists per template, to know each card's "next stage".
  useEffect(() => {
    const templates = workflows.data?.templates || [];
    if (templates.length === 0) return;
    let cancelled = false;
    Promise.all(templates.map(async (t) => {
      const res = await apiFetch(`/api/v1/workflows/${t.id}/stages`);
      return [t.id, [...res.data.stages].sort((a, b) => a.orderIndex - b.orderIndex)];
    })).then((entries) => { if (!cancelled) setStagesByTemplate(Object.fromEntries(entries)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workflows.data]);

  const myTeamIds = useMemo(() => {
    if (auth.isOrgAdmin) return (teams.data?.teams || []).map((t) => t.id);
    return [...new Set([...auth.hrTeamIds, ...auth.managedTeamIds])];
  }, [auth.isOrgAdmin, auth.hrTeamIds, auth.managedTeamIds, teams.data]);
  const myTeams = (teams.data?.teams || []).filter((t) => myTeamIds.includes(t.id));

  const all = (trackers.data?.trackers || []).filter((t) => myTeamIds.includes(t.teamId));
  const scoped = scope === 'mine' ? all.filter((t) => t.assignedHr === user.id) : all;

  const active = scoped.filter((t) => t.status === 'active');
  const held = scoped.filter((t) => t.status === 'on_hold');
  const closed = scoped.filter((t) => CLOSED.includes(t.status));

  // One chip per stage that actually has people in it, in pipeline order.
  const stageChips = useMemo(() => {
    const seen = new Map();
    for (const t of active) {
      const st = t.currentStage;
      if (st && !seen.has(st.stageKey)) {
        const list = stagesByTemplate[t.workflowTemplateId] || [];
        seen.set(st.stageKey, { key: st.stageKey, label: st.name, order: list.findIndex((s) => s.id === st.id) });
      }
    }
    return [...seen.values()].sort((a, b) => a.order - b.order).map((c) => ({ ...c, count: active.filter((t) => t.currentStage?.stageKey === c.key).length }));
  }, [active, stagesByTemplate]);

  const chips = [
    { key: 'all', label: 'Active', count: active.length }, ...stageChips,
    { key: 'hold', label: 'On hold', count: held.length }, { key: 'closed', label: 'Closed', count: closed.length },
  ];

  const visible = filter === 'all' ? active : filter === 'hold' ? held : filter === 'closed' ? closed : active.filter((t) => t.currentStage?.stageKey === filter);
  const canAdvance = can(roles, 'workflow_actions', 'advance');
  const canBlock = can(roles, 'workflow_actions', 'block');
  const canHold = can(roles, 'workflow_actions', 'hold');
  const canWrite = can(roles, 'trackers', 'write');

  function nextStageOf(t) {
    const list = stagesByTemplate[t.workflowTemplateId] || [];
    const idx = list.findIndex((s) => s.id === t.currentStage?.id);
    return idx >= 0 ? list[idx + 1] || null : null;
  }

  async function act(t, verb, body) {
    setBusyId(t.id);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/trackers/${t.id}/${verb}`, { method: 'POST', body });
      await trackers.reload();
    } catch (err) {
      setActionError(errorMessage(err, `Could not ${verb} this candidate.`));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {/* Mine / Team */}
      <div className="mb-3 inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Scope">
        {[['mine', 'My candidates'], ['team', 'Whole team']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={scope === k} onClick={() => { setScope(k); setFilter('all'); }}
            className={`h-9 rounded-md px-3 text-sm font-medium ${scope === k ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{label}</button>
        ))}
      </div>
      <Chips items={chips} value={filter} onChange={setFilter} className="mb-4" />

      <ErrorNote onRetry={trackers.reload}>{trackers.error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {trackers.loading && !trackers.data && <Loading />}

      {trackers.data && visible.length === 0 && (
        <EmptyState
          title={filter === 'all' ? (scope === 'mine' ? 'Nothing assigned to you yet' : 'The pipeline is empty') : 'Nobody here'}
          body={scope === 'mine' && canWrite ? 'Tap + to add a candidate, or switch to Whole team.' : undefined}
        />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((t) => {
          const next = nextStageOf(t);
          const busy = busyId === t.id;
          return (
            <Card key={t.id} className="gap-3 p-4">
              <div className="flex items-start gap-3">
                <Avatar name={t.candidateName} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{t.candidateName}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.openPositionDesignation || 'No position'}{t.clientName ? ` · ${t.clientName}` : ''}</div>
                </div>
                {t.candidatePhone && (
                  <a href={`tel:${t.candidatePhone}`} aria-label={`Call ${t.candidateName}`} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground active:scale-95"><Phone className="size-5" /></a>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t.status === 'active' && t.currentStage && <StatusPill status="trialing">{t.currentStage.name}</StatusPill>}
                {t.status !== 'active' && <StatusPill status={t.status} />}
                {t.currentStageEnteredAt && t.status === 'active' && <span>{relativeTime(t.currentStageEnteredAt).replace(' ago', '')} in stage</span>}
                {t.interviewDate && t.status === 'active' && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{shortDate(t.interviewDate)}</span>}
              </div>

              {t.status === 'active' && (
                <div className="flex gap-2">
                  {canAdvance && (
                    <Button className="flex-1" disabled={busy || !next} onClick={() => act(t, 'advance', { nextStageId: next.id })}>
                      {next ? <>Move to {next.name} <ArrowRight /></> : 'Final stage'}
                    </Button>
                  )}
                  {canHold && <Button variant="outline" size="icon" aria-label="Put on hold" disabled={busy} onClick={() => act(t, 'hold')}><Pause /></Button>}
                  {canBlock && <Button variant="outline" size="icon" aria-label="Reject" disabled={busy} onClick={() => { setRejecting(t); setReason(''); }}><X /></Button>}
                </div>
              )}
              {t.status === 'on_hold' && canHold && (
                <Button variant="outline" disabled={busy} onClick={() => act(t, 'resume')}><Play /> Resume</Button>
              )}
            </Card>
          );
        })}
      </div>

      {canWrite && myTeams.length > 0 && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="pb-safe fixed bottom-20 right-4 z-20 flex h-14 items-center gap-2 rounded-full bg-primary px-5 font-medium text-primary-foreground shadow-lg active:scale-95 md:bottom-8 md:right-8"
        >
          <Plus className="size-5" /> Add candidate
        </button>
      )}

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.candidateName || ''}?`}>
        <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); await act(rejecting, 'block', { reason: reason.trim() }); setRejecting(null); }}>
          <div className="grid gap-2">
            <Label htmlFor="rej-reason">Reason</Label>
            <Input id="rej-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Salary expectation too high" required autoFocus />
          </div>
          <Button type="submit" variant="destructive">Reject candidate</Button>
        </form>
      </Sheet>

      <QuickAdd
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teams={myTeams}
        positions={(positions.data?.positions || []).filter((p) => p.status === 'open')}
        defaultCountry={org.data?.organization?.defaultCountry || 'IN'}
        meId={user.id}
        onAdded={() => { setAddOpen(false); setScope('mine'); setFilter('all'); trackers.reload(); }}
      />
    </>
  );
}

function QuickAdd({ open, onClose, teams, positions, defaultCountry, meId, onAdded }) {
  const EMPTY = { firstName: '', lastName: '', phone: '', phoneCountry: defaultCountry, teamId: '', openPositionId: '' };
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);

  useEffect(() => {
    if (open) { setForm({ ...EMPTY, teamId: teams[0]?.id || '' }); setError(null); setDuplicate(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));
  const teamPositions = positions.filter((p) => p.teamId === form.teamId);

  async function submit(confirmDuplicate = false) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/trackers', {
        method: 'POST',
        body: {
          teamId: form.teamId,
          assignedHr: meId,
          openPositionId: form.openPositionId || undefined,
          candidate: {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim() || undefined,
            phone: form.phone.trim(),
            phoneCountry: form.phoneCountry,
            ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
          },
        },
      });
      onAdded();
    } catch (err) {
      const dup = err instanceof ApiError && err.status === 409 ? err.body?.data?.possibleDuplicate : null;
      if (dup) setDuplicate(dup);
      else setError(errorMessage(err, 'Could not add this candidate.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add candidate">
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setDuplicate(null); submit(false); }}>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2"><Label htmlFor="qa-first">First name</Label><Input id="qa-first" value={form.firstName} onChange={update('firstName')} required autoComplete="off" /></div>
          <div className="grid gap-2"><Label htmlFor="qa-last">Last name</Label><Input id="qa-last" value={form.lastName} onChange={update('lastName')} autoComplete="off" /></div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
          <div className="grid gap-2"><Label htmlFor="qa-cc">Country</Label>
            <NativeSelect id="qa-cc" value={form.phoneCountry} onChange={update('phoneCountry')}>{COUNTRIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</NativeSelect></div>
          <div className="grid gap-2"><Label htmlFor="qa-phone">Phone</Label><Input id="qa-phone" type="tel" inputMode="tel" value={form.phone} onChange={update('phone')} required autoComplete="off" /></div>
        </div>
        {teams.length > 1 && (
          <div className="grid gap-2"><Label htmlFor="qa-team">Team</Label>
            <NativeSelect id="qa-team" value={form.teamId} onChange={(e) => setForm((s) => ({ ...s, teamId: e.target.value, openPositionId: '' }))}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></div>
        )}
        <div className="grid gap-2"><Label htmlFor="qa-pos">For position (optional)</Label>
          <NativeSelect id="qa-pos" value={form.openPositionId} onChange={update('openPositionId')}>
            <option value="">No position yet</option>
            {teamPositions.map((p) => <option key={p.id} value={p.id}>{p.designation}{p.clientName ? ` — ${p.clientName}` : ''}</option>)}
          </NativeSelect></div>

        {duplicate && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30" role="alert">
            <p className="font-medium">This number may already be in your database</p>
            <p className="mt-1 text-muted-foreground">{fullName(duplicate) || 'A candidate'}{duplicate.phone ? ` · ${duplicate.phone}` : ''}</p>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setDuplicate(null)}>Cancel</Button>
              <Button type="button" className="flex-1" disabled={busy} onClick={() => submit(true)}>Add anyway</Button>
            </div>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        {!duplicate && <Button type="submit" size="lg" disabled={busy || !form.teamId}>{busy ? 'Adding…' : 'Add to my pipeline'}</Button>}
      </form>
    </Sheet>
  );
}

// ── Candidates ───────────────────────────────────────────────────────────
function CandidatesTab() {
  const { data, loading, error, reload } = useFetch('/api/v1/candidates');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data?.candidates || [];
    if (!needle) return all;
    return all.filter((c) => [fullName(c), c.email, c.phone, c.location, ...(c.skills || [])].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [data, q]);

  return (
    <>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" placeholder="Search name, phone, skill…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Search candidates" />
      </div>
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      {loading && !data && <Loading />}
      {data && list.length === 0 && <EmptyState title="No candidates found" />}
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((c) => (
          <Card key={c.id} className="gap-2 p-4">
            <div className="flex items-start gap-3">
              <Avatar name={fullName(c)} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{fullName(c)}</div>
                <div className="truncate text-xs text-muted-foreground">{c.location || 'Location not set'} · {String(c.source).replace(/_/g, ' ')}</div>
              </div>
              {c.phone && <a href={`tel:${c.phone}`} aria-label={`Call ${fullName(c)}`} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Phone className="size-5" /></a>}
              {c.email && <a href={`mailto:${c.email}`} aria-label={`Email ${fullName(c)}`} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted"><Mail className="size-5" /></a>}
            </div>
            {(c.skills || []).length > 0 && (
              <div className="flex flex-wrap gap-1">{c.skills.slice(0, 5).map((s) => <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{s}</span>)}</div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

// ── Jobs ─────────────────────────────────────────────────────────────────
function JobsTab() {
  const { roles } = useAuth();
  const { data, loading, error, reload } = useFetch('/api/v1/job-postings');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const canPublish = can(roles, 'job_postings', 'publish');
  const canClose = can(roles, 'job_postings', 'close');

  async function act(job, action) {
    setBusyId(job.id);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/job-postings/${job.id}/${action}`, { method: 'POST' });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, `Could not ${action} this job.`));
    } finally {
      setBusyId(null);
    }
  }

  const jobs = data?.jobs || [];
  return (
    <>
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {loading && !data && <Loading />}
      {data && jobs.length === 0 && <EmptyState title="No job postings yet" body="Create one from the classic view." action={<Button asChild variant="outline"><Link to="/hr/classic">Open classic view</Link></Button>} />}
      <div className="grid gap-3 md:grid-cols-2">
        {jobs.map((j) => (
          <Card key={j.id} className="gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold">{j.title}</div>
                <div className="truncate text-xs text-muted-foreground">{[j.location, String(j.workMode).replace('_', ' '), String(j.employmentType).replace('_', ' ')].filter(Boolean).join(' · ')}</div>
              </div>
              <StatusPill status={j.status} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{j.vacancies} vacanc{j.vacancies === 1 ? 'y' : 'ies'}</span>
              <span>{j.publishedAt ? `Published ${relativeTime(j.publishedAt)}` : 'Not published'}</span>
            </div>
            <div className="flex gap-2">
              {canPublish && ['draft', 'paused'].includes(j.status) && <Button className="flex-1" disabled={busyId === j.id} onClick={() => act(j, 'publish')}>Publish</Button>}
              {canClose && j.status === 'published' && <Button className="flex-1" variant="outline" disabled={busyId === j.id} onClick={() => act(j, 'close')}>Close</Button>}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
