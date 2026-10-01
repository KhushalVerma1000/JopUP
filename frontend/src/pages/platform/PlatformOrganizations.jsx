import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { AppLayout } from '../../components/AppLayout';
import { useFetch } from '../../hooks/useFetch';
import { PageHeader, Chips, ErrorNote, Loading, EmptyState, StatusPill } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { relativeTime, daysUntil } from '../../lib/format';

const STATUSES = [
  { key: '', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'trialing', label: 'Trial' },
  { key: 'suspended', label: 'Suspended' }, { key: 'cancelled', label: 'Cancelled' },
];

export function PlatformOrganizations() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const path = useMemo(() => {
    const qs = new URLSearchParams({ limit: '50' });
    if (debounced) qs.set('search', debounced);
    if (status) qs.set('status', status);
    return `/api/v1/platform/organizations?${qs}`;
  }, [debounced, status]);

  const { data, loading, error, reload } = useFetch(path);
  const orgs = data?.organisations || [];

  return (
    <AppLayout wide>
      <PageHeader title="Organisations" subtitle={data ? `${data.total} enrolled` : ' '} />

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" placeholder="Search by name or workspace ID" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" aria-label="Search organisations" />
      </div>
      <Chips items={STATUSES} value={status} onChange={setStatus} className="mb-4" />

      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      {loading && !data && <Loading />}
      {data && orgs.length === 0 && <EmptyState title="No organisations match" body="Try a different search or status filter." />}

      <div className="grid gap-3 md:grid-cols-2">
        {orgs.map((o) => {
          const trialDays = o.status === 'trialing' ? daysUntil(o.trialEndsAt) : null;
          return (
            <Link key={o.id} to={`/platform/organizations/${o.id}`} className="block">
              <Card className="gap-3 p-4 transition-colors hover:bg-accent/30">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{o.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{o.slug} · {o.plan.name}</div>
                  </div>
                  <StatusPill status={o.status} />
                </div>
                <dl className="grid grid-cols-4 gap-2 text-center">
                  {[['Users', o.counts.users], ['Teams', o.counts.teams], ['Candidates', o.counts.candidates], ['Clients', o.counts.clients]].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-muted/60 py-1.5">
                      <dd className="text-base font-semibold tabular-nums">{v}</dd>
                      <dt className="text-[11px] text-muted-foreground">{k}</dt>
                    </div>
                  ))}
                </dl>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Active {relativeTime(o.lastActiveAt)}</span>
                  {trialDays !== null && <span className={trialDays <= 3 ? 'font-medium text-destructive' : ''}>{trialDays <= 0 ? 'Trial ends today' : `Trial: ${trialDays}d left`}</span>}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </AppLayout>
  );
}
