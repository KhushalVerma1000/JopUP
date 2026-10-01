import { Link } from 'react-router-dom';
import { ClipboardList, Briefcase, Building2, Users, Settings, CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../hooks/useFetch';
import { AppLayout } from '../components/AppLayout';
import { PageHeader, Section, StatusPill } from '@/components/common';
import { Card } from '@/components/ui/card';
import { daysUntil, formatMoney } from '../lib/format';

const TILES = [
  { to: '/manager', title: 'Team workbench', body: 'Approvals, pipeline health, workload.', icon: ClipboardList },
  { to: '/hr', title: 'Pipeline', body: 'Candidates, jobs and stage moves.', icon: Briefcase },
  { to: '/clients', title: 'Clients', body: 'Client accounts and sharing.', icon: Building2 },
  { to: '/employees', title: 'People', body: 'Directory and access approvals.', icon: Users },
  { to: '/managerial', title: 'Settings', body: 'Organisation, teams, invitations.', icon: Settings },
];

/** Org admin home: trial status, getting-started checklist, and links to every workbench. */
export function DashboardPage() {
  const { user, roles } = useAuth();
  const org = useFetch('/api/v1/organizations/me');
  const users = useFetch('/api/v1/users');
  const clients = useFetch('/api/v1/clients');

  const o = org.data?.organization;
  const trialDays = o?.status === 'trialing' ? daysUntil(o.trialEndsAt) : null;

  const steps = [
    { done: (users.data?.users?.length || 0) > 1, label: 'Invite your first manager or HR', hint: 'They get a link to join your workspace.', to: '/managerial' },
    { done: (clients.data?.clients?.length || 0) > 0, label: 'Add your first client', hint: 'The companies you recruit for.', to: '/clients' },
  ];
  const showChecklist = users.data && clients.data && steps.some((s) => !s.done);

  return (
    <AppLayout>
      <PageHeader
        title={`Welcome, ${user.firstName}`}
        subtitle={o ? `${o.name} · ${roles.map((r) => r.roleName.replace('_', ' ')).join(', ')}` : ' '}
      />

      {o && o.status === 'trialing' && (
        <Card className="mb-6 gap-2 border-primary/30 bg-accent/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">
              Free trial{trialDays !== null && <> · {trialDays <= 0 ? 'ends today' : `${trialDays} day${trialDays === 1 ? '' : 's'} left`}</>}
            </div>
            <StatusPill status="trialing">{o.plan?.name}</StatusPill>
          </div>
          <p className="text-sm text-muted-foreground">
            You're on the {o.plan?.name} plan ({formatMoney(o.plan?.priceMonthly)}/mo after the trial). Online payment is coming soon — we'll
            contact you before your trial ends.
          </p>
        </Card>
      )}

      {showChecklist && (
        <Section title="Get started">
          <Card className="divide-y p-0">
            {steps.map((s) => (
              <Link key={s.label} to={s.to} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-accent/40">
                {s.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${s.done ? 'text-muted-foreground line-through' : ''}`}>{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Workbenches">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TILES.map((t) => {
            const Icon = t.icon;
            return (
              <Link key={t.to} to={t.to}>
                <Card className="h-full flex-row items-center gap-3 p-4 transition-colors hover:bg-accent/30">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Icon className="size-5" /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{t.title}</span>
                    <span className="block text-sm text-muted-foreground">{t.body}</span>
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      </Section>
    </AppLayout>
  );
}
