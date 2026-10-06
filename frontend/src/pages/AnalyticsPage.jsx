import { useState } from 'react';
import { Users, Trophy, Target, Hourglass, AlertTriangle, Clock } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { FunnelRow } from '../components/charts';
import { useFetch } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { useHrScope } from '../hooks/useHrScope';
import { can } from '../lib/roles';
import { PageHeader, Section, StatTile, ErrorNote, Loading, EmptyState, Chips, Bar, Avatar } from '@/components/common';
import { Card } from '@/components/ui/card';

const PERIODS = [
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
];

const days = (n) => (n === null || n === undefined ? '—' : `${n}d`);

/**
 * Pipeline analytics. Every number comes from GET /api/v1/analytics/pipeline
 * (computed in SQL, scoped to the caller's teams), so this page only lays it
 * out — it never downloads the candidate list to count it.
 */
export function AnalyticsPage() {
  const { roles } = useAuth();
  const scope = useHrScope();
  const [teamId, setTeamId] = useState('');
  const [period, setPeriod] = useState('90');

  const qs = new URLSearchParams({ days: period });
  if (teamId) qs.set('teamId', teamId);
  const pipeline = useFetch(`/api/v1/analytics/pipeline?${qs}`);
  // The scorecard needs the KPI module; on plans without it the call 403s and the section simply stays hidden.
  const overview = useFetch(can(roles, 'kpi', 'read') ? '/api/v1/performance/overview' : null);

  const d = pipeline.data;
  const s = d?.summary;
  const funnelMax = Math.max(1, ...(d?.funnel || []).map((f) => f.reached));
  const teamChips = [{ key: '', label: 'All teams' }, ...scope.myTeams.map((t) => ({ key: t.id, label: t.name }))];
  const scorecard = (overview.data?.teams || []).filter((t) => !teamId || t.teamId === teamId);
  const loading = pipeline.loading && !d;

  return (
    <AppLayout wide>
      <PageHeader title="Analytics" subtitle="How your pipeline is converting, and where candidates get stuck." />

      <div className="mb-5 grid gap-3">
        {scope.myTeams.length > 1 && <Chips items={teamChips} value={teamId} onChange={setTeamId} />}
        <Chips items={PERIODS} value={period} onChange={setPeriod} />
      </div>

      <ErrorNote onRetry={pipeline.reload}>{pipeline.error}</ErrorNote>

      {loading ? <Loading label="Crunching your pipeline…" /> : d && s.total === 0 && d.positions.openCount === 0 ? (
        <EmptyState
          title="No candidates in this view yet"
          body="Tag candidates to an open position and their progress will show up here. Try a longer time range if you expected data."
        />
      ) : d && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="In pipeline" value={s.active} sub={s.onHold ? `${s.onHold} on hold` : 'Active candidates'} icon={Users} />
            <StatTile label="Placed" value={s.placed} sub={s.winRatePct === null ? 'No closed candidates yet' : `${s.winRatePct}% of closed candidates`} icon={Trophy} tone={s.placed ? 'good' : 'default'} />
            <StatTile label="Positions filled" value={`${d.positions.filled}/${d.positions.vacancies}`} sub={d.positions.fillRatePct === null ? 'No open vacancies' : `${d.positions.fillRatePct}% of vacancies`} icon={Target} />
            <StatTile
              label="Avg. time in stage"
              value={days(s.avgDaysInCurrentStage)}
              sub={s.stuck ? `${s.stuck} stuck over ${d.stuckAfterDays} days` : 'Nothing stuck'}
              icon={s.stuck ? AlertTriangle : Hourglass}
              tone={s.stuck ? 'warn' : 'default'}
            />
          </div>
          {s.avgDaysToPlace !== null && (
            <p className="-mt-3 mb-6 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden /> Placed candidates took {days(s.avgDaysToPlace)} on average from first tracked to joined.
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Conversion funnel" hint="Everyone who ever reached each stage, including those later placed or rejected. Percentages compare with the stage above.">
              <Card className="grid gap-2.5 p-4">
                {d.funnel.length === 0 ? <p className="text-sm text-muted-foreground">No stage history in this period yet.</p> : d.funnel.map((f) => (
                  <FunnelRow key={f.stageKey} label={f.name} count={f.reached} max={funnelMax} conversion={f.conversionFromPrevious ?? undefined} />
                ))}
                {d.funnel.some((f) => f.avgDaysInStage !== null) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Slowest stage: {(() => { const slow = [...d.funnel].filter((f) => f.avgDaysInStage !== null).sort((a, b) => b.avgDaysInStage - a.avgDaysInStage)[0]; return `${slow.name} (${days(slow.avgDaysInStage)} on average)`; })()}
                  </p>
                )}
              </Card>
            </Section>

            <Section title="Recruiter performance" hint="Candidates each recruiter is carrying and has placed in this period.">
              {d.recruiters.length === 0 ? (
                <EmptyState title="No assigned recruiters yet" body="Assign candidates to a recruiter to compare workloads and placements." />
              ) : (
                <Card className="divide-y p-0">
                  {d.recruiters.map((r) => (
                    <div key={r.userId} className="flex items-center gap-3 px-4 py-3">
                      <Avatar name={r.name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{r.name}</div>
                        <Bar value={r.active} max={Math.max(1, ...d.recruiters.map((x) => x.active))} label={`${r.name} live candidates`} className="mt-1.5" />
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div><span className="text-sm font-semibold tabular-nums text-foreground">{r.active}</span> live</div>
                        <div><span className="text-sm font-semibold tabular-nums text-foreground">{r.placed}</span> placed{r.winRatePct !== null ? ` · ${r.winRatePct}%` : ''}</div>
                      </div>
                    </div>
                  ))}
                </Card>
              )}
            </Section>

            <Section title="Positions to fill" hint="Open positions with the most vacancies still left.">
              {d.positions.needingAttention.length === 0 ? (
                <EmptyState title="Every open position is filled" body="New open positions with vacancies will appear here." />
              ) : (
                <Card className="divide-y p-0">
                  {d.positions.needingAttention.slice(0, 5).map((p) => (
                    <div key={p.id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{p.designation}{p.clientName ? ` · ${p.clientName}` : ''}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{p.filled}/{p.vacancies} filled</span>
                      </div>
                      <Bar value={p.filled} max={p.vacancies || 1} label={`${p.designation} filled`} className="mt-2" />
                      <p className="mt-1 text-xs text-muted-foreground">{p.liveCandidates} in progress · open {p.ageDays} days</p>
                    </div>
                  ))}
                </Card>
              )}
            </Section>

            <Section title="Placements by client" hint="Where your placements and live candidates sit, by client.">
              {d.clients.length === 0 ? (
                <EmptyState title="No client activity yet" body="Candidates tagged to a client’s position will be grouped here." />
              ) : (
                <Card className="grid gap-2.5 p-4">
                  {d.clients.slice(0, 5).map((c) => (
                    <FunnelRow key={c.clientId} label={c.name} count={c.placed} max={Math.max(1, d.clients[0].placed)} />
                  ))}
                  <p className="mt-1 text-xs text-muted-foreground">Bars show placed candidates; clients with only live candidates show 0.</p>
                </Card>
              )}
            </Section>
          </div>

          {scorecard.length > 0 && (
            <Section title="Team scorecard" hint="KPIs, goals and reviews at a glance. Open Performance for details." className="mt-6">
              <div className="grid gap-3 md:grid-cols-2">
                {scorecard.map((t) => (
                  <Card key={t.teamId} className="gap-2 p-4 text-sm">
                    <h3 className="font-semibold">{t.teamName}</h3>
                    <div className="flex justify-between"><span className="text-muted-foreground">KPIs on target</span><span className="tabular-nums">{t.kpis.onTarget}/{t.kpis.total}{t.kpis.offTarget ? ` · ${t.kpis.offTarget} off target` : ''}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Goals</span><span className="tabular-nums">{t.goals.active} active{t.goals.overdue ? ` · ${t.goals.overdue} overdue` : ''}{t.goals.averageProgressPct !== null ? ` · ${t.goals.averageProgressPct}% avg` : ''}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Reviews</span><span className="tabular-nums">{t.reviews.drafts} draft · {t.reviews.awaitingAcknowledgement} awaiting</span></div>
                  </Card>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </AppLayout>
  );
}
