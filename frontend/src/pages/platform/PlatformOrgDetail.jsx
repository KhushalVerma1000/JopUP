import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { AppLayout } from '../../components/AppLayout';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { PageHeader, Section, StatTile, ErrorNote, Loading, StatusPill, Bar } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatMoney, relativeTime, shortDate, daysUntil } from '../../lib/format';

const LIMIT_ROWS = [
  ['max_teams', 'teams', 'Teams'], ['max_candidates', 'candidates', 'Candidates'], ['max_clients', 'clients', 'Clients'],
];

export function PlatformOrgDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useFetch(`/api/v1/platform/organizations/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  async function setStatus(status, confirmText) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/organizations/${id}`, { method: 'PATCH', body: { status } });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not update the organisation.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppLayout wide>
      <Link to="/platform/organizations" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Organisations
      </Link>
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {loading && !data && <Loading />}
      {data && (() => {
        const { organisation: o, plan, subscription: sub, counts, admins, teams, credits } = data;
        const trialDays = o.status === 'trialing' ? daysUntil(o.trialEndsAt) : null;
        return (
          <>
            <PageHeader
              title={o.name}
              subtitle={`${o.slug} · joined ${shortDate(o.createdAt)}`}
              action={<StatusPill status={o.status} />}
            />

            <div className="mb-6 flex flex-wrap gap-2">
              {o.status === 'suspended' || o.status === 'cancelled' ? (
                <Button disabled={busy} onClick={() => setStatus('active', `Reactivate ${o.name}? Everyone in this workspace can sign in again.`)}>Reactivate</Button>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => setStatus('suspended', `Suspend ${o.name}? Everyone in this workspace will be blocked from signing in.`)}>Suspend</Button>
              )}
            </div>

            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Active users" value={counts.users} sub={counts.pendingUsers ? `${counts.pendingUsers} awaiting approval` : undefined} tone={counts.pendingUsers ? 'warn' : 'default'} />
              <StatTile label="Candidates" value={counts.candidates} sub={`${counts.activeTrackers} in pipeline`} />
              <StatTile label="Clients" value={counts.clients} />
              <StatTile label="Live jobs" value={counts.liveJobs} sub={`${counts.openPositions} open positions`} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Section title="Plan & billing">
                <Card className="gap-3 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-semibold">{plan?.name}</span>
                    <span className="text-sm">{formatMoney(plan?.priceMonthly)}<span className="text-xs text-muted-foreground">/mo</span></span>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Subscription</dt><dd className="text-right capitalize">{sub?.status || '—'}</dd>
                    {trialDays !== null && (<><dt className="text-muted-foreground">Trial ends</dt><dd className="text-right">{trialDays <= 0 ? 'today' : `in ${trialDays} days`}</dd></>)}
                    <dt className="text-muted-foreground">Payment method</dt><dd className="text-right">{sub?.paymentProvider || 'Not connected'}</dd>
                    <dt className="text-muted-foreground">Credits</dt><dd className="text-right tabular-nums">{credits?.balance ?? '—'}</dd>
                  </dl>
                  <div className="flex flex-col gap-3 border-t pt-3">
                    {LIMIT_ROWS.map(([limitKey, countKey, label]) => {
                      const limit = plan?.limits?.[limitKey];
                      if (limit === undefined) return null;
                      const used = counts[countKey];
                      return (
                        <div key={limitKey}>
                          <div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="tabular-nums text-muted-foreground">{used} / {limit < 0 ? '∞' : limit}</span></div>
                          <Bar value={limit < 0 ? 0 : used} max={limit < 0 ? 1 : limit} tone={limit > 0 && used / limit > 0.85 ? 'warn' : 'primary'} />
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </Section>

              <div>
                <Section title="Admins">
                  <Card className="divide-y p-0">
                    {admins.length === 0 && <p className="p-4 text-sm text-muted-foreground">No org admin.</p>}
                    {admins.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{a.name}</div>
                          <a href={`mailto:${a.email}`} className="block truncate text-xs text-primary underline-offset-4 hover:underline">{a.email}</a>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(a.lastLoginAt)}</span>
                      </div>
                    ))}
                  </Card>
                </Section>

                <Section title="Teams">
                  <Card className="divide-y p-0">
                    {teams.length === 0 && <p className="p-4 text-sm text-muted-foreground">No teams yet.</p>}
                    {teams.map((t) => (
                      <div key={t.id} className="flex items-center justify-between px-4 py-3 text-sm">
                        <span className="font-medium">{t.name}</span>
                        <span className="text-muted-foreground">{t.members} member{t.members === 1 ? '' : 's'}</span>
                      </div>
                    ))}
                  </Card>
                </Section>
              </div>
            </div>

            <Section title="Modules included">
              <div className="flex flex-wrap gap-2">
                {(plan?.modules || []).map((m) => (
                  <span key={m} className="rounded-full border bg-card px-3 py-1 text-xs">{m.replace(/_/g, ' ')}</span>
                ))}
              </div>
            </Section>
          </>
        );
      })()}
    </AppLayout>
  );
}
