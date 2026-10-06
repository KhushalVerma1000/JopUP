import { useMemo, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../hooks/useFetch';
import { useHrScope } from '../hooks/useHrScope';
import { can } from '../lib/roles';
import { PageHeader, Chips, Notice } from '@/components/common';
import { KpiTab } from '../components/performance/KpiTab';
import { GoalsTab } from '../components/performance/GoalsTab';
import { ReviewsTab } from '../components/performance/ReviewsTab';
import { StrategyTab } from '../components/performance/StrategyTab';

/**
 * Performance — KPIs, goals, reviews and strategy for the teams you work in.
 * Tabs appear only when the role has read access to that area; write controls
 * only when it has write access (mirrors the backend permission keys).
 */
export function PerformancePage() {
  const { roles } = useAuth();
  const scope = useHrScope();
  const users = useFetch('/api/v1/users?status=active');
  const userList = users.data?.users || [];

  const tabs = useMemo(() => [
    { key: 'kpis', label: 'KPIs', show: can(roles, 'kpi', 'read') },
    { key: 'goals', label: 'Goals', show: can(roles, 'goals', 'read') },
    { key: 'reviews', label: 'Reviews', show: can(roles, 'performance_reviews', 'read') },
    { key: 'strategy', label: 'Strategy', show: can(roles, 'strategy', 'read') },
  ].filter((t) => t.show), [roles]);

  const [tab, setTab] = useState(null);
  const active = tabs.find((t) => t.key === tab)?.key || tabs[0]?.key;
  const teams = scope.myTeams;

  return (
    <AppLayout wide>
      <PageHeader title="Performance" subtitle="Track targets, goals and reviews for your team." />
      {tabs.length > 1 && <Chips className="mb-5" items={tabs.map(({ key, label }) => ({ key, label }))} value={active} onChange={setTab} />}

      {!active ? (
        <Notice tone="warn" title="You don’t have access to performance data yet">Ask your organisation admin to enable it for your role.</Notice>
      ) : teams.length === 0 && !scope.positionsLoading ? (
        <Notice title="You’re not on a team yet">Performance data is organised by team. Once an admin adds you to one, it will show up here.</Notice>
      ) : (
        <>
          {active === 'kpis' && <KpiTab teams={teams} canWrite={can(roles, 'kpi', 'write')} />}
          {active === 'goals' && <GoalsTab teams={teams} users={userList} canWrite={can(roles, 'goals', 'write')} />}
          {active === 'reviews' && <ReviewsTab teams={teams} users={userList} canWrite={can(roles, 'performance_reviews', 'write')} />}
          {active === 'strategy' && <StrategyTab teams={teams} canWrite={can(roles, 'strategy', 'write')} />}
        </>
      )}
    </AppLayout>
  );
}
