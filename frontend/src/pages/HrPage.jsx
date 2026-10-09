import { useEffect, useMemo, useState } from 'react';
import { Phone, Plus, Pause, Play, X, ArrowRight, Search, Mail, CalendarClock, CalendarPlus, ListChecks, Table2, Copy, Check, Briefcase, MapPin, Tag, MessageCircle } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../context/AuthContext';
import { useFetch, errorMessage } from '../hooks/useFetch';
import { useHrScope } from '../hooks/useHrScope';
import { apiFetch, ApiError } from '../lib/api';
import { can } from '../lib/roles';
import { buildUpdateText, copyStageLabel, copyText } from '../lib/clipboard';
import { whatsappUrl, whatsappProps } from '../lib/whatsapp';
import { dayKey, resolveDay, lineupLabel } from '../lib/lineupDay';
import { PageHeader, Chips, ErrorNote, Loading, EmptyState, Sheet, Avatar, StatusPill, Field, Notice, Fab, RoundAction } from '@/components/common';
import { PositionsTab } from '../components/hr/PositionsTab';
import { PositionPicker } from '../components/hr/PositionPicker';
import { StageUpdateSheet } from '../components/hr/StageUpdateSheet';
import { LineupDateSheet } from '../components/hr/LineupDateSheet';
import { MailComposeSheet } from '../components/hr/MailComposeSheet';
import { TrackerMailSheet } from '../components/hr/TrackerMailSheet';
import { BulkBar } from '../components/hr/BulkBar';
import { BulkDatesSheet } from '../components/hr/BulkDatesSheet';
import { BulkStatusSheet } from '../components/hr/BulkStatusSheet';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { relativeTime, shortDate, fullName } from '../lib/format';

const COUNTRIES = [['IN', 'India +91'], ['US', 'United States +1'], ['GB', 'United Kingdom +44'], ['AE', 'UAE +971'], ['SG', 'Singapore +65'], ['CA', 'Canada +1'], ['AU', 'Australia +61']];
const TABS = [{ key: 'pipeline', label: 'Pipeline' }, { key: 'positions', label: 'Positions' }, { key: 'candidates', label: 'Candidates' }];
const CLOSED = ['rejected', 'withdrawn', 'placed'];

/**
 * HR workbench — phone-first. Three tabs, in the order the work happens:
 *   Positions  – the demand (open requisitions) you're filling
 *   Candidates – the supply (your database)
 *   Pipeline   – who is where, and what to move or call next
 * Job postings are secondary and live under Positions.
 */
export function HrPage() {
  const auth = useAuth();
  const scope = useHrScope();
  const [tab, setTab] = useState('pipeline');
  // Set by "Pipeline" on a position card: jump to the pipeline filtered to it.
  const [positionFilter, setPositionFilter] = useState('');
  // Lifted so "View pipeline" can switch to the whole team: a position's pipeline
  // is made of several HRs' candidates, and "My candidates" would show a fraction.
  const [scopeKey, setScopeKey] = useState('mine');

  function viewPipeline(positionId) { setPositionFilter(positionId); setScopeKey('team'); setTab('pipeline'); }

  return (
    <AppLayout wide>
      <PageHeader title="HR workbench" subtitle={`Hi ${auth.user.firstName} — here's what needs you today.`} />
      <Chips items={TABS} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'pipeline' && <PipelineTab scope={scope} scopeKey={scopeKey} setScopeKey={setScopeKey} positionFilter={positionFilter} setPositionFilter={setPositionFilter} />}
      {tab === 'positions' && <PositionsTab scope={scope} onViewPipeline={viewPipeline} />}
      {tab === 'candidates' && <CandidatesTab scope={scope} />}
    </AppLayout>
  );
}

// ── Pipeline ─────────────────────────────────────────────────────────────
function PipelineTab({ scope, scopeKey, setScopeKey, positionFilter, setPositionFilter }) {
  const auth = useAuth();
  const { user, roles } = auth;
  const { myTeamIds, myTeams, positions, openPositions, reloadPositions } = scope;
  const trackers = useFetch('/api/v1/trackers');
  const workflows = useFetch('/api/v1/workflows');
  const org = useFetch('/api/v1/organizations/me');

  const [stagesByTemplate, setStagesByTemplate] = useState({});
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [updating, setUpdating] = useState(null);   // tracker being moved (stage-update sheet)
  const [tagging, setTagging] = useState(null);     // tracker being (re)tagged to a position
  const [copiedId, setCopiedId] = useState(null);
  const [dayChoice, setDayChoice] = useState('any');   // 'any' | 'today' | 'tomorrow' | 'YYYY-MM-DD'
  const [pickedDay, setPickedDay] = useState('');
  const [datingLineup, setDatingLineup] = useState(null); // tracker whose lineup date is being set
  const [trackerMail, setTrackerMail] = useState(null);       // tracker ids for the client tracker mail
  const [mail, setMail] = useState(null);                 // { type, trackerIds, date }
  const [selecting, setSelecting] = useState(false);       // bulk selection mode
  const [selected, setSelected] = useState(() => new Set());
  const [bulk, setBulk] = useState(null);                  // { kind: 'dates' | 'status', trackers } — a snapshot, so it survives the reload after Apply

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

  const all = (trackers.data?.trackers || []).filter((t) => myTeamIds.includes(t.teamId));
  const byScope = scopeKey === 'mine' ? all.filter((t) => t.assignedHr === user.id) : all;
  const byPosition = positionFilter === 'none' ? byScope.filter((t) => !t.openPositionId)
    : positionFilter ? byScope.filter((t) => t.openPositionId === positionFilter) : byScope;
  // Lineup day: HR's local calendar day, compared on the lineup date HR set.
  const wantedDay = dayChoice === 'pick' ? pickedDay : resolveDay(dayChoice);
  const scoped = wantedDay ? byPosition.filter((t) => dayKey(t.lineupDate) === wantedDay) : byPosition;

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
  const canTemplates = can(roles, 'tracker_templates', 'read');

  // Only people HR can still change are selectable, and only those on screen
  // count: switching a filter quietly drops the ones that are no longer shown.
  const selectable = visible.filter((t) => t.status === 'active' || t.status === 'on_hold');
  const picked = selectable.filter((t) => selected.has(t.id));
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(picked.length === selectable.length ? new Set() : new Set(selectable.map((t) => t.id)));
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  // Stage choices for a bulk move: the workflow most of the selection is on.
  const bulkStageOptions = useMemo(() => {
    const counts = new Map();
    for (const t of (bulk?.trackers || [])) counts.set(t.workflowTemplateId, (counts.get(t.workflowTemplateId) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top ? stagesByTemplate[top] || [] : [];
  }, [bulk, stagesByTemplate]);

  function nextStageOf(t) {
    const list = stagesByTemplate[t.workflowTemplateId] || [];
    const idx = list.findIndex((s) => s.id === t.currentStage?.id);
    return idx >= 0 ? list[idx + 1] || null : null;
  }

  const VERB_LABEL = { hold: 'put this candidate on hold', resume: 'resume this candidate', block: 'reject this candidate' };

  // Resolves true on success so callers (the reject sheet) can stay open on failure.
  async function act(t, verb, body) {
    setBusyId(t.id);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/trackers/${t.id}/${verb}`, { method: 'POST', body });
      await Promise.all([trackers.reload(), reloadPositions()]);
      return true;
    } catch (err) {
      setActionError(errorMessage(err, `Could not ${VERB_LABEL[verb] || verb}.`));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function moveStage(t, { stage, note }) {
    await apiFetch(`/api/v1/trackers/${t.id}/advance`, { method: 'POST', body: { nextStageId: stage.id, ...(note ? { note } : {}) } });
    await Promise.all([trackers.reload(), reloadPositions()]);
  }

  async function tagPosition(t, positionId) {
    setTagging(null);
    setBusyId(t.id);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/trackers/${t.id}`, { method: 'PATCH', body: { openPositionId: positionId } });
      await Promise.all([trackers.reload(), reloadPositions()]);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not tag this candidate.'));
    } finally {
      setBusyId(null);
    }
  }

  async function copyCard(t) {
    const ok = await copyText(buildUpdateText({
      name: t.candidateName, phone: t.candidatePhone, location: t.candidateLocation, position: t.openPositionDesignation,
      stage: t.currentStage ? copyStageLabel(t.currentStage.stageKey, t.currentStage.name) : undefined, status: t.currentStageNote,
    }));
    if (ok) { setCopiedId(t.id); setTimeout(() => setCopiedId((id) => (id === t.id ? null : id)), 1500); }
    else setActionError('Your browser blocked copying. Use the Move button instead — it shows the text so you can copy it by hand.');
  }

  const filterPositions = positions.filter((p) => all.some((t) => t.openPositionId === p.id) || p.status === 'open');

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-muted p-1" role="tablist" aria-label="Scope">
          {[['mine', 'My candidates'], ['team', 'Whole team']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={scopeKey === k} onClick={() => { setScopeKey(k); setFilter('all'); }}
              className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${scopeKey === k ? 'border bg-background shadow-sm' : 'border border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>
          ))}
        </div>
        <NativeSelect aria-label="Filter by position" className="min-w-0 flex-1 md:max-w-xs" value={positionFilter} onChange={(e) => { setPositionFilter(e.target.value); setFilter('all'); }}>
          <option value="">All positions</option>
          <option value="none">Not tagged to a position</option>
          {filterPositions.map((p) => <option key={p.id} value={p.id}>{p.designation}{p.clientName ? ` — ${p.clientName}` : ''}</option>)}
        </NativeSelect>
        {canTemplates && active.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setTrackerMail((selecting && selected.size ? [...selected] : active.map((t) => t.id)))}>
            <Table2 /> Email tracker ({selecting && selected.size ? selected.size : active.length})
          </Button>
        )}
        {(canWrite || canAdvance || canHold || canBlock) && selectable.length > 0 && (
          <Button type="button" variant={selecting ? 'default' : 'outline'} size="sm" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
            <ListChecks /> {selecting ? 'Selecting' : 'Select'}
          </Button>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chips className="min-w-0 flex-1"
          items={[{ key: 'any', label: 'Any day' }, { key: 'today', label: 'Lineup today' }, { key: 'tomorrow', label: 'Lineup tomorrow' }, { key: 'pick', label: wantedDay && dayChoice === 'pick' ? lineupLabel(`${wantedDay}T12:00:00`) : 'Pick a date' }]}
          value={dayChoice} onChange={(k) => { setDayChoice(k); setFilter('all'); }} />
        {dayChoice === 'pick' && <Input type="date" aria-label="Lineup date" className="w-auto" value={pickedDay} onChange={(e) => setPickedDay(e.target.value)} />}
      </div>
      {wantedDay && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{active.length} lined up on {lineupLabel(`${wantedDay}T12:00:00`)}</p>
          {active.length > 0 && (
            <Button size="sm" onClick={() => setMail({ type: 'lineup', trackerIds: active.map((t) => t.id), date: wantedDay })}><Mail /> Email lineup ({active.length})</Button>
          )}
        </div>
      )}
      <Chips items={chips} value={filter} onChange={setFilter} className="mb-4" />

      <ErrorNote onRetry={trackers.reload}>{trackers.error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {trackers.loading && !trackers.data && <Loading />}

      {trackers.data && visible.length === 0 && (
        <EmptyState
          title={wantedDay && filter === 'all' ? 'Nobody is lined up on that day' : filter === 'all' ? (scopeKey === 'mine' ? 'No candidates assigned to you' : 'No candidates in the pipeline yet') : 'No candidates at this stage'}
          body={wantedDay ? 'Set a lineup date on a candidate card, or pick another day.' : filter !== 'all' || !canWrite ? undefined : scopeKey === 'mine' ? 'Add a candidate to start tracking them, or switch to Whole team to see everyone’s.' : 'Add a candidate to start tracking them through the stages.'}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {visible.map((t) => {
          const next = nextStageOf(t);
          const busy = busyId === t.id;
          return (
            <Card key={t.id} className={`gap-3 p-4 ${selecting && selected.has(t.id) && (t.status === 'active' || t.status === 'on_hold') ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-start gap-3">
                {selecting && (t.status === 'active' || t.status === 'on_hold') && (
                  <input type="checkbox" className="mt-2 size-5 shrink-0 accent-primary" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} aria-label={`Select ${t.candidateName}`} />
                )}
                <Avatar name={t.candidateName} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{t.candidateName}</div>
                  <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {t.candidateLocation && <><MapPin className="size-3 shrink-0" aria-hidden /><span className="truncate">{t.candidateLocation}</span></>}
                  </div>
                </div>
                <RoundAction onClick={() => copyCard(t)} aria-label={copiedId === t.id ? 'Copied' : `Copy details for ${t.candidateName}`}>
                  {copiedId === t.id ? <Check className="size-5 text-primary" aria-hidden /> : <Copy className="size-5" aria-hidden />}
                </RoundAction>
                {whatsappUrl(t.candidatePhoneE164, t.candidatePhone) && <RoundAction href={whatsappUrl(t.candidatePhoneE164, t.candidatePhone)} {...whatsappProps} aria-label={`WhatsApp ${t.candidateName}`}><MessageCircle className="size-5" aria-hidden /></RoundAction>}
                {t.candidatePhone && <RoundAction tone="accent" href={`tel:${t.candidatePhone}`} aria-label={`Call ${t.candidateName}`}><Phone className="size-5" aria-hidden /></RoundAction>}
              </div>

              {/* Position: tap to tag / change */}
              {canWrite && t.status !== 'rejected' && t.status !== 'placed' ? (
                <button type="button" disabled={busy} onClick={() => setTagging(t)}
                  className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent active:bg-accent ${t.openPositionId ? 'bg-card' : 'border-dashed text-muted-foreground'}`}>
                  {t.openPositionId ? <Briefcase className="size-4 shrink-0 text-muted-foreground" /> : <Tag className="size-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{t.openPositionId ? <>{t.openPositionDesignation}{t.clientName ? <span className="text-muted-foreground"> · {t.clientName}</span> : null}</> : 'Tag to position'}</span>
                  {t.openPositionId && <span className="shrink-0 text-xs text-muted-foreground">Change</span>}
                </button>
              ) : (
                <div className="truncate text-sm text-muted-foreground">{t.openPositionDesignation || 'No position'}{t.clientName ? ` · ${t.clientName}` : ''}</div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t.status === 'active' && t.currentStage && <StatusPill status="trialing">{t.currentStage.name}</StatusPill>}
                {t.status === 'active' && t.currentStageNote && <span className="inline-flex items-center rounded-full border bg-card px-2 py-0.5 text-xs font-medium text-foreground">{t.currentStageNote}</span>}
                {t.status !== 'active' && <StatusPill status={t.status} />}
                {t.currentStageEnteredAt && t.status === 'active' && <span>{relativeTime(t.currentStageEnteredAt).replace(' ago', '')} in stage</span>}
                {t.interviewDate && t.status === 'active' && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />Interview {shortDate(t.interviewDate)}</span>}
              </div>

              {t.status === 'active' && (canWrite || t.interviewDate) && (
                <div className="flex flex-wrap gap-2">
                  {canWrite && (
                    <button type="button" disabled={busy} onClick={() => setDatingLineup(t)}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors hover:bg-accent ${t.lineupDate ? 'bg-card' : 'border-dashed text-muted-foreground'}`}>
                      {t.lineupDate ? <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> : <CalendarPlus className="size-4" aria-hidden />}
                      {t.lineupDate ? <>Lineup {lineupLabel(t.lineupDate)}</> : 'Set lineup date'}
                    </button>
                  )}
                  {t.interviewDate && (
                    <button type="button" onClick={() => setMail({ type: 'interview_reminder', trackerIds: [t.id] })}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-md border bg-card px-3 text-sm transition-colors hover:bg-accent">
                      <Mail className="size-4 text-muted-foreground" aria-hidden /> Remind
                    </button>
                  )}
                </div>
              )}

              {t.status === 'active' && (
                <div className="flex gap-2">
                  {canAdvance && (
                    <Button className="flex-1" disabled={busy || !next} onClick={() => setUpdating(t)}>
                      {next ? <>Move to {next.name} <ArrowRight /></> : 'No further stages'}
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

      {canWrite && myTeams.length > 0 && !selecting && <Fab icon={Plus} onClick={() => setAddOpen(true)}>Add candidate</Fab>}

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.candidateName || ''}?`}
        description="They'll move to Closed and drop out of the active pipeline. This can't be undone from here.">
        <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); if (await act(rejecting, 'block', { reason: reason.trim() })) setRejecting(null); }}>
          <Field label="Reason" htmlFor="rej-reason">
            <Input id="rej-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Salary expectation too high" required autoFocus />
          </Field>
          <ErrorNote>{actionError}</ErrorNote>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setRejecting(null)}>Keep in pipeline</Button>
            <Button type="submit" variant="destructive" className="flex-1" disabled={busyId === rejecting?.id}>Reject candidate</Button>
          </div>
        </form>
      </Sheet>

      {selecting && (
        <BulkBar count={picked.length} total={selectable.length} onToggleAll={toggleAll} onCancel={stopSelecting}
          canDates={canWrite} canStatus={canAdvance || canHold || canBlock}
          onDates={() => setBulk({ kind: 'dates', trackers: picked })} onStatus={() => setBulk({ kind: 'status', trackers: picked })} />
      )}

      <BulkDatesSheet
        trackers={bulk?.kind === 'dates' ? bulk.trackers : null}
        onClose={() => setBulk(null)}
        onApplied={() => { trackers.reload(); stopSelecting(); }}
      />
      <BulkStatusSheet
        trackers={bulk?.kind === 'status' ? bulk.trackers : null}
        allowed={{ advance: canAdvance, hold: canHold, resume: canHold, block: canBlock }}
        stageOptions={bulkStageOptions}
        onClose={() => setBulk(null)}
        onApplied={() => { trackers.reload(); stopSelecting(); }}
      />

      <LineupDateSheet
        tracker={datingLineup}
        onClose={() => setDatingLineup(null)}
        onSave={async (iso) => {
          await apiFetch(`/api/v1/trackers/${datingLineup.id}`, { method: 'PATCH', body: { lineupDate: iso } });
          await trackers.reload();
        }}
      />

      <TrackerMailSheet open={!!trackerMail} onClose={() => setTrackerMail(null)} trackerIds={trackerMail || []} />

      <MailComposeSheet
        open={!!mail}
        onClose={() => setMail(null)}
        type={mail?.type || 'lineup'}
        trackerIds={mail?.trackerIds || []}
        date={mail?.date}
        whatsappFor={(m) => (mail?.type === 'interview_reminder' ? whatsappUrl(m.candidatePhoneE164, m.candidatePhone, m.whatsappText) : null)}
      />

      <StageUpdateSheet
        tracker={updating}
        stages={updating ? stagesByTemplate[updating.workflowTemplateId] || [] : []}
        defaultStageId={updating ? nextStageOf(updating)?.id : ''}
        onClose={() => setUpdating(null)}
        onConfirm={(args) => moveStage(updating, args)}
      />

      <PositionPicker
        open={!!tagging}
        onClose={() => setTagging(null)}
        title={`Tag ${tagging?.candidateName || ''} to a position`}
        positions={openPositions.filter((p) => p.teamId === tagging?.teamId)}
        selectedId={tagging?.openPositionId}
        allowClear
        clearLabel="Remove position tag"
        onSelect={(id) => tagPosition(tagging, id)}
      />

      <QuickAdd
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teams={myTeams}
        positions={openPositions}
        defaultCountry={org.data?.organization?.defaultCountry || 'IN'}
        meId={user.id}
        onAdded={() => { setAddOpen(false); setScopeKey('mine'); setFilter('all'); trackers.reload(); reloadPositions(); }}
      />
    </>
  );
}

function QuickAdd({ open, onClose, teams, positions, defaultCountry, meId, onAdded }) {
  const EMPTY = { firstName: '', lastName: '', phone: '', phoneCountry: defaultCountry, location: '', teamId: '', openPositionId: '' };
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (open) { setForm({ ...EMPTY, teamId: teams[0]?.id || '' }); setError(null); setDuplicate(null); setPickerOpen(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));
  const teamPositions = positions.filter((p) => p.teamId === form.teamId);
  const chosen = positions.find((p) => p.id === form.openPositionId);

  // mode 'new': create the candidate from the form (confirmDuplicate skips the
  // phone check once HR has seen the warning). mode 'existing': track the
  // candidate we already have for this number instead of creating a second record.
  async function submit(mode = 'new', confirmDuplicate = false) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/trackers', {
        method: 'POST',
        body: {
          teamId: form.teamId,
          assignedHr: meId,
          openPositionId: form.openPositionId || undefined,
          ...(mode === 'existing'
            ? { candidateId: duplicate.id }
            : {
              candidate: {
                firstName: form.firstName.trim(),
                lastName: form.lastName.trim() || undefined,
                phone: form.phone.trim(),
                phoneCountry: form.phoneCountry,
                location: form.location.trim() || undefined,
                ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
              },
            }),
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
    <>
      <Sheet open={open} onClose={onClose} title="Add candidate">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setDuplicate(null); submit('new', false); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor="qa-first"><Input id="qa-first" value={form.firstName} onChange={update('firstName')} required autoComplete="off" autoFocus /></Field>
            <Field label="Last name" htmlFor="qa-last"><Input id="qa-last" value={form.lastName} onChange={update('lastName')} autoComplete="off" /></Field>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
            <Field label="Country" htmlFor="qa-cc"><NativeSelect id="qa-cc" value={form.phoneCountry} onChange={update('phoneCountry')}>{COUNTRIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</NativeSelect></Field>
            <Field label="Phone" htmlFor="qa-phone"><Input id="qa-phone" type="tel" inputMode="tel" value={form.phone} onChange={update('phone')} required autoComplete="off" /></Field>
          </div>
          <Field label="Location (optional)" htmlFor="qa-loc"><Input id="qa-loc" value={form.location} onChange={update('location')} placeholder="City" autoComplete="off" /></Field>
          {teams.length > 1 && (
            <Field label="Team" htmlFor="qa-team"><NativeSelect id="qa-team" value={form.teamId} onChange={(e) => setForm((s) => ({ ...s, teamId: e.target.value, openPositionId: '' }))}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
          )}
          <Field label="Position (optional)" htmlFor="qa-pos">
            <button id="qa-pos" type="button" onClick={() => setPickerOpen(true)} className={`flex min-h-11 items-center gap-2 rounded-md border bg-background px-3 text-left text-sm transition-colors hover:bg-accent md:min-h-9 ${chosen ? '' : 'border-dashed text-muted-foreground'}`}>
              <Briefcase className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{chosen ? `${chosen.designation}${chosen.clientName ? ` — ${chosen.clientName}` : ''}` : 'Tag to position'}</span>
            </button>
          </Field>

          {duplicate && (
            <Notice
              tone="warn"
              title="This number is already saved"
              actions={<>
                <Button type="button" disabled={busy} onClick={() => submit('existing')}>Use {duplicate.firstName || 'existing candidate'}</Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => submit('new', true)}>Add as a new candidate</Button>
                <Button type="button" variant="ghost" onClick={() => setDuplicate(null)}>Edit number</Button>
              </>}
            >
              {fullName(duplicate) || 'A candidate'}{duplicate.phone ? ` · ${duplicate.phone}` : ''}. Use them to avoid a duplicate record, or add a separate candidate if this is a different person.
            </Notice>
          )}
          <ErrorNote>{error}</ErrorNote>
          {!duplicate && <Button type="submit" size="lg" disabled={busy || !form.teamId}>{busy ? 'Adding…' : 'Add to my pipeline'}</Button>}
        </form>
      </Sheet>
      <PositionPicker
        open={open && pickerOpen}
        onClose={() => setPickerOpen(false)}
        positions={teamPositions}
        selectedId={form.openPositionId}
        allowClear
        onSelect={(id) => { setForm((s) => ({ ...s, openPositionId: id || '' })); setPickerOpen(false); }}
      />
    </>
  );
}

// ── Candidates ───────────────────────────────────────────────────────────
function CandidatesTab({ scope }) {
  const { roles } = useAuth();
  const { openPositions, reloadPositions } = scope;
  const { data, loading, error, reload } = useFetch('/api/v1/candidates');
  const [q, setQ] = useState('');
  const [tagging, setTagging] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const canTag = can(roles, 'trackers', 'write');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data?.candidates || [];
    if (!needle) return all;
    return all.filter((c) => [fullName(c), c.email, c.phone, c.location, ...(c.skills || [])].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [data, q]);

  async function tag(candidate, positionId) {
    const position = openPositions.find((p) => p.id === positionId);
    setTagging(null);
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch('/api/v1/trackers', { method: 'POST', body: { teamId: position.teamId, candidateId: candidate.id, openPositionId: position.id } });
      setNotice(`${fullName(candidate)} tagged to ${position.designation}.`);
      reloadPositions();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not tag this candidate.'));
    }
  }

  return (
    <>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" placeholder="Search name, phone, skill…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Search candidates" />
      </div>
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {notice && <Notice tone="good" className="mb-4">{notice}</Notice>}
      {loading && !data && <Loading />}
      {data && list.length === 0 && <EmptyState title="No candidates found" />}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((c) => (
          <Card key={c.id} className="gap-3 p-4">
            <div className="flex items-start gap-3">
              <Avatar name={fullName(c)} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{fullName(c)}</div>
                <div className="truncate text-xs text-muted-foreground">{c.location || 'Location not set'} · {String(c.source).replace(/_/g, ' ')}</div>
              </div>
              {whatsappUrl(c.phoneNormalized, c.phone) && <RoundAction href={whatsappUrl(c.phoneNormalized, c.phone)} {...whatsappProps} aria-label={`WhatsApp ${fullName(c)}`}><MessageCircle className="size-5" aria-hidden /></RoundAction>}
              {c.phone && <RoundAction tone="accent" href={`tel:${c.phone}`} aria-label={`Call ${fullName(c)}`}><Phone className="size-5" aria-hidden /></RoundAction>}
              {c.email && <RoundAction href={`mailto:${c.email}`} aria-label={`Email ${fullName(c)}`}><Mail className="size-5" aria-hidden /></RoundAction>}
            </div>
            {(c.skills || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">{c.skills.slice(0, 5).map((s) => <Badge key={s} variant="secondary" className="border-border font-normal">{s}</Badge>)}</div>
            )}
            {canTag && <Button variant="outline" size="sm" className="self-start" onClick={() => { setNotice(null); setTagging(c); }}><Tag /> Tag to position</Button>}
          </Card>
        ))}
      </div>

      <PositionPicker
        open={!!tagging}
        onClose={() => setTagging(null)}
        title={`Tag ${tagging ? fullName(tagging) : ''} to a position`}
        positions={openPositions}
        onSelect={(id) => tag(tagging, id)}
      />
    </>
  );
}
