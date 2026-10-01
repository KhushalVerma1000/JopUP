import { Link } from 'react-router-dom';
import { Building2, Users, TrendingUp, Clock, UserCheck, Briefcase } from 'lucide-react';
import { AppLayout } from '../../components/AppLayout';
import { useFetch } from '../../hooks/useFetch';
import { PageHeader, Section, StatTile, ErrorNote, Loading, EmptyState, StatusPill, Bar } from '@/components/common';
import { Card } from '@/components/ui/card';
import { formatMoney, compact, relativeTime, daysUntil } from '../../lib/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PlatformOverview() {
  const { data, loading, error, reload } = useFetch('/api/v1/platform/metrics');

  return (
    <AppLayout wide>
      <PageHeader title="Platform overview" subtitle="Every organisation enrolled on JopUP." />
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      {loading && !data && <Loading />}
      {data && <Body m={data} />}
    </AppLayout>
  );
}

function Body({ m }) {
  const { organisations: o, revenue, usage } = m;
  const maxSignups = Math.max(1, ...m.signupsByMonth.map((s) => s.orgs));
  const maxPlan = Math.max(1, ...m.byPlan.map((p) => p.orgs));

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Building2} label="Organisations" value={o.total} sub={`${o.new30d} new in 30 days`} />
        <StatTile icon={TrendingUp} tone="good" label="Monthly revenue" value={formatMoney(revenue.mrr)} sub="Active orgs, list price" />
        <StatTile icon={Clock} label="On trial" value={o.trialing} sub={`${formatMoney(revenue.trialPipelineMrr)}/mo if converted`} />
        <StatTile icon={Users} tone={o.suspended ? 'warn' : 'default'} label="Suspended" value={o.suspended} sub={`${o.cancelled} cancelled`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="New organisations" hint="Last 6 months">
          <Card className="p-4">
            <div className="flex h-36 items-end gap-2" role="img" aria-label="New organisations per month">
              {m.signupsByMonth.map((s) => {
                const [, mm] = s.month.split('-');
                return (
                  <div key={s.month} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-xs font-medium tabular-nums">{s.orgs || ''}</span>
                    <div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(4, (s.orgs / maxSignups) * 100)}px` }} />
                    <span className="text-[11px] text-muted-foreground">{MONTHS[Number(mm) - 1]}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </Section>

        <Section title="Organisations by plan">
          <Card className="flex flex-col gap-3 p-4">
            {m.byPlan.map((p) => (
              <div key={p.slug}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{p.name}</span><span className="tabular-nums text-muted-foreground">{p.orgs}</span></div>
                <Bar value={p.orgs} max={maxPlan} />
              </div>
            ))}
          </Card>
        </Section>
      </div>

      <Section title="Across all organisations">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Active users" value={compact(usage.users)} />
          <StatTile label="Awaiting approval" value={usage.pendingUsers} tone={usage.pendingUsers ? 'warn' : 'default'} icon={UserCheck} />
          <StatTile label="Candidates" value={compact(usage.candidates)} />
          <StatTile label="Clients" value={compact(usage.clients)} />
          <StatTile label="Live jobs" value={compact(usage.liveJobs)} icon={Briefcase} />
          <StatTile label="In pipeline" value={compact(usage.activeTrackers)} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Trials ending within 7 days" hint="Reach out before they lapse">
          {m.trialsEnding.length === 0 ? (
            <EmptyState title="No trials ending soon" />
          ) : (
            <OrgList items={m.trialsEnding} right={(t) => {
              const d = daysUntil(t.trialEndsAt);
              return <span className={d <= 2 ? 'font-medium text-destructive' : 'text-muted-foreground'}>{d <= 0 ? 'today' : `${d}d left`}</span>;
            }} />
          )}
        </Section>

        <Section title="Recent signups" action={<Link to="/platform/organizations" className="text-sm font-medium text-primary underline-offset-4 hover:underline">View all</Link>}>
          <OrgList items={m.recentSignups} right={(r) => <span className="flex items-center gap-2"><StatusPill status={r.status} /><span className="text-xs text-muted-foreground">{relativeTime(r.createdAt)}</span></span>} />
        </Section>
      </div>
    </>
  );
}

function OrgList({ items, right }) {
  return (
    <Card className="divide-y p-0">
      {items.map((it) => (
        <Link key={it.id} to={`/platform/organizations/${it.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-accent/40">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{it.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{it.planName}</span>
          </span>
          <span className="shrink-0 text-sm">{right(it)}</span>
        </Link>
      ))}
    </Card>
  );
}
