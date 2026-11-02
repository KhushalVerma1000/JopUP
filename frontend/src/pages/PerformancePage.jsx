import { useMemo, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../hooks/useFetch';
import { useHrScope } from '../hooks/useHrScope';
import { can } from '../lib/roles';
import { PageHeader, Chips, Notice } from '@/components/common';
import { PlanLock } from '../components/PlanLock';
import { usePlan } from '../hooks/usePlan';
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
  const { has } = usePlan();
  const scope = useHrScope();
  const users = useFetch('/api/v1/users?status=active');
  const userList = users.data?.users || [];

  // A tab stays visible when the plan lacks its module (marked "Pro") so the
  // feature can be seen and wanted; its content is the upgrade card, not an API error.
  const tabs = useMemo(() => [
    { key: 'kpis', label: 'KPIs', module: 'kpi_engine', show: can(roles, 'kpi', 'read') },
    { key: 'goals', label: 'Goals', module: 'kpi_engine', show: can(roles, 'goals', 'read') },
    { key: 'reviews', label: 'Reviews', module: 'performance_reviews', show: can(roles, 'performance_reviews', 'read') },
    { key: 'strategy', label: 'Strategy', module: 'strategy_planner', show: can(roles, 'strategy', 'read') },
  ].filter((t) => t.show).map((t) => ({ ...t, locked: !has(t.module) })), [roles, has]);

  const [tab, setTab] = useState(null);
  const active = tabs.find((t) => t.key === tab)?.key || tabs[0]?.key;
  const teams = scope.myTeams;

  return (
    <AppLayout wide>
      <PageHeader title="Performance" subtitle="Track targets, goals and reviews for your team." />
      {tabs.length > 1 && <Chips className="mb-5" items={tabs.map(({ key, label, locked }) => ({ key, label: locked ? `${label} · Pro` : label }))} value={active} onChange={setTab} />}

      {!active ? (
        <Notice tone="warn" title="You don’t have access to performance data yet">Ask your organisation admin to enable it for your role.</Notice>
      ) : tabs.find((t) => t.key === active)?.locked ? (
        <PlanLock title={`${tabs.find((t) => t.key === active).label} is a Pro feature`}>
          KPIs, goals, reviews and strategy track your team against targets, using the pipeline data you already have.
        </PlanLock>
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
