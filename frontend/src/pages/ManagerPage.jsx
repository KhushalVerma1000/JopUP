import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CalendarClock, PauseCircle, Target, Check, X, AlertTriangle, Phone } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../context/AuthContext';
import { useFetch, errorMessage } from '../hooks/useFetch';
import { apiFetch } from '../lib/api';
import { PageHeader, Section, StatTile, ErrorNote, Loading, EmptyState, Sheet, Avatar, Bar, Chips } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fullName, relativeTime, shortDate } from '../lib/format';
import { ROLE_LABELS } from '../lib/roles';

const STAGE_ORDER = ['applied', 'screening', 'lineup', 'turnup', 'interview', 'offer', 'joined'];
const STAGE_LABEL = { applied: 'Applied', screening: 'Screening', lineup: 'Lineup', turnup: 'Turn-up', interview: 'Interview', offer: 'Offer', joined: 'Joined' };
const DAY = 86_400_000;
const STUCK_AFTER_DAYS = 5;

/**
 * Manager workbench — answers, in order: what needs my decision (approvals),
 * how is the pipeline doing, what's slipping, who's carrying what.
 * Everything is derived from list endpoints the manager already has access
 * to; filtering to "my team(s)" happens here because those endpoints return
 * the whole organisation.
 */
export function ManagerPage() {
  const auth = useAuth();
  const teams = useFetch('/api/v1/teams');
  const trackers = useFetch('/api/v1/trackers');
  const positions = useFetch('/api/v1/open-positions');
  const users = useFetch('/api/v1/users?status=active');
  const approvals = useFetch('/api/v1/auth/pending-approvals');

  const [teamFilter, setTeamFilter] = useState('');
  const [reject, setReject] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const myTeams = useMemo(() => {
    const all = teams.data?.teams || [];
    return auth.isOrgAdmin ? all : all.filter((t) => auth.managedTeamIds.includes(t.id));
  }, [teams.data, auth.isOrgAdmin, auth.managedTeamIds]);

  const scope = useMemo(() => new Set(teamFilter ? [teamFilter] : myTeams.map((t) => t.id)), [teamFilter, myTeams]);
  const inScope = (teamId) => scope.has(teamId);

  const scopedTrackers = useMemo(() => (trackers.data?.trackers || []).filter((t) => inScope(t.teamId)), [trackers.data, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = scopedTrackers.filter((t) => t.status === 'active');
  const onHold = scopedTrackers.filter((t) => t.status === 'on_hold');

  const now = Date.now();
  const interviewsSoon = live.filter((t) => t.interviewDate && new Date(t.interviewDate) - now > -DAY && new Date(t.interviewDate) - now < 7 * DAY)
    .sort((a, b) => new Date(a.interviewDate) - new Date(b.interviewDate));
  const stuck = live.filter((t) => t.currentStageEnteredAt && now - new Date(t.currentStageEnteredAt) > STUCK_AFTER_DAYS * DAY && t.currentStage?.stageKey !== 'joined')
    .sort((a, b) => new Date(a.currentStageEnteredAt) - new Date(b.currentStageEnteredAt));

  const funnel = STAGE_ORDER.map((key) => ({ key, count: live.filter((t) => t.currentStage?.stageKey === key).length })).filter((s) => s.count > 0 || ['applied', 'screening', 'interview', 'offer'].includes(s.key));
  const funnelMax = Math.max(1, ...funnel.map((s) => s.count));

  const scopedPositions = (positions.data?.positions || []).filter((p) => inScope(p.teamId) && p.status === 'open');
  const vacanciesLeft = scopedPositions.reduce((n, p) => n + Math.max(0, p.vacancies - p.filledCount), 0);

  const pending = (approvals.data?.pendingUsers || []).filter((u) => !u.requestedTeamId || inScope(u.requestedTeamId));

  // HR workload: how many live candidates each HR in scope is carrying.
  const hrs = useMemo(() => (users.data?.users || [])
    .filter((u) => u.roles.some((r) => r.roleName === 'hr' && inScope(r.teamId)))
    .map((u) => ({ ...u, load: live.filter((t) => t.assignedHr === u.id).length }))
    .sort((a, b) => b.load - a.load), [users.data, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxLoad = Math.max(1, ...hrs.map((h) => h.load));

  async function decide(userId, verb, body) {
    setBusyId(userId);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/auth/pending-approvals/${userId}/${verb}`, { method: 'POST', body });
      await Promise.all([approvals.reload(), users.reload()]);
      setReject(null);
      setRejectReason('');
    } catch (err) {
      setActionError(errorMessage(err, `Could not ${verb} this request.`));
    } finally {
      setBusyId(null);
    }
  }

  const loading = teams.loading || (trackers.loading && !trackers.data);
  const loadError = teams.error || trackers.error || positions.error;

  return (
    <AppLayout wide>
      <PageHeader title="Team workbench" subtitle={teamFilter ? myTeams.find((t) => t.id === teamFilter)?.name : myTeams.length > 1 ? 'All your teams' : myTeams[0]?.name} />

      {myTeams.length > 1 && (
        <Chips className="mb-5" value={teamFilter} onChange={setTeamFilter}
          items={[{ key: '', label: 'All teams' }, ...myTeams.map((t) => ({ key: t.id, label: t.name }))]} />
      )}
      <ErrorNote onRetry={() => { trackers.reload(); positions.reload(); teams.reload(); }}>{loadError}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {loading && <Loading />}

      {!loading && myTeams.length === 0 && (
        <EmptyState title="You don't manage a team yet" body="Ask your org admin to assign you as a manager of a team." />
      )}

      {!loading && myTeams.length > 0 && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={Activity} label="In pipeline" value={live.length} sub={`${onHold.length} on hold`} />
            <StatTile icon={CalendarClock} label="Interviews · 7 days" value={interviewsSoon.length} />
            <StatTile icon={Target} label="Open positions" value={scopedPositions.length} sub={`${vacanciesLeft} seats to fill`} />
            <StatTile icon={PauseCircle} tone={stuck.length ? 'warn' : 'default'} label={`Stuck ${STUCK_AFTER_DAYS}d+`} value={stuck.length} sub="Need a nudge" />
          </div>

          {pending.length > 0 && (
            <Section title={`Approvals waiting (${pending.length})`} hint="New team members can't sign in until you decide.">
              <Card className="divide-y p-0">
                {pending.map((u) => (
                  <div key={u.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar name={fullName(u)} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{fullName(u)}</div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                        <div className="text-xs text-muted-foreground">Wants: <span className="font-medium text-foreground">{ROLE_LABELS[u.requestedRoleName] || u.requestedRoleName}</span> · {u.requestedTeamName}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1 sm:flex-none" disabled={busyId === u.id} onClick={() => decide(u.id, 'approve')}><Check /> Approve</Button>
                      <Button className="flex-1 sm:flex-none" variant="outline" disabled={busyId === u.id} onClick={() => setReject(u)}><X /> Decline</Button>
                    </div>
                  </div>
                ))}
              </Card>
            </Section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Pipeline" hint="Live candidates by stage">
              <Card className="flex flex-col gap-3 p-4">
                {live.length === 0 && <p className="text-sm text-muted-foreground">Nobody in the pipeline yet.</p>}
                {live.length > 0 && funnel.map((s) => (
                  <div key={s.key}>
                    <div className="mb-1 flex justify-between text-sm"><span>{STAGE_LABEL[s.key]}</span><span className="font-medium tabular-nums">{s.count}</span></div>
                    <Bar value={s.count} max={funnelMax} />
                  </div>
                ))}
              </Card>
            </Section>

            <Section title="Needs attention">
              <Card className="divide-y p-0">
                {interviewsSoon.length === 0 && stuck.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">All clear — nothing stuck and no interviews coming up.</p>
                )}
                {interviewsSoon.slice(0, 4).map((t) => (
                  <AttentionRow key={`i-${t.id}`} tracker={t} icon={<CalendarClock className="size-4 text-primary" />} note={`Interview ${shortDate(t.interviewDate)}`} />
                ))}
                {stuck.slice(0, 5).map((t) => (
                  <AttentionRow key={`s-${t.id}`} tracker={t} icon={<AlertTriangle className="size-4 text-amber-600" />} note={`${t.currentStage?.name} for ${relativeTime(t.currentStageEnteredAt).replace(' ago', '')}`} />
                ))}
              </Card>
            </Section>

            <Section title="Open positions" action={<Link to="/clients" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Clients</Link>}>
              <Card className="divide-y p-0">
                {scopedPositions.length === 0 && <p className="p-4 text-sm text-muted-foreground">No open positions.</p>}
                {scopedPositions.map((p) => {
                  const inFlight = live.filter((t) => t.openPositionId === p.id).length;
                  return (
                    <div key={p.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{p.designation}</div>
                          <div className="truncate text-xs text-muted-foreground">{p.clientName || 'Internal'}{p.location ? ` · ${p.location}` : ''}</div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground"><span className="font-medium text-foreground">{inFlight}</span> in flight</div>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <Bar value={p.filledCount} max={p.vacancies} />
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.filledCount}/{p.vacancies} filled</span>
                      </div>
                    </div>
                  );
                })}
              </Card>
            </Section>

            <Section title="HR workload" hint="Live candidates per recruiter">
              <Card className="divide-y p-0">
                {hrs.length === 0 && <p className="p-4 text-sm text-muted-foreground">No HR staff on this team yet.</p>}
                {hrs.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 p-4">
                    <Avatar name={fullName(h)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium">{fullName(h)}</span><span className="tabular-nums">{h.load}</span></div>
                      <Bar className="mt-1.5" value={h.load} max={maxLoad} />
                    </div>
                  </div>
                ))}
              </Card>
            </Section>
          </div>
        </>
      )}

      <Sheet open={!!reject} onClose={() => setReject(null)} title={`Decline ${reject ? fullName(reject) : ''}?`}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); decide(reject.id, 'reject', rejectReason.trim() ? { reason: rejectReason.trim() } : {}); }}>
          <div className="grid gap-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Input id="reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Wrong team" />
          </div>
          <Button type="submit" variant="destructive" disabled={busyId === reject?.id}>Decline request</Button>
        </form>
      </Sheet>
    </AppLayout>
  );
}

function AttentionRow({ tracker: t, icon, note }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t.candidateName}</div>
        <div className="truncate text-xs text-muted-foreground">{note}{t.openPositionDesignation ? ` · ${t.openPositionDesignation}` : ''}</div>
      </div>
      {t.candidatePhone && (
        <a href={`tel:${t.candidatePhone}`} aria-label={`Call ${t.candidateName}`} className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground"><Phone className="size-4" /></a>
      )}
    </div>
  );
}
