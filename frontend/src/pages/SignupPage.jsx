import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFetch, errorMessage } from '../hooks/useFetch';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote } from '@/components/common';
import { formatMoney } from '../lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const COUNTRIES = [
  ['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'United Arab Emirates'],
  ['SG', 'Singapore'], ['CA', 'Canada'], ['AU', 'Australia'],
];

const MODULE_LABELS = {
  client_management: 'Clients', candidate_db: 'Candidates', job_posting: 'Job postings', workflow_engine: 'Workflows',
  pipeline_tracker: 'Pipeline tracker', kpi_engine: 'KPIs', performance_reviews: 'Reviews', strategy_planner: 'Strategy',
  job_portal: 'Job portal', analytics: 'Analytics', ai_screening: 'AI screening', sms_notifications: 'SMS',
};

function limitLine(limits = {}) {
  const fmt = (n) => (n < 0 ? 'Unlimited' : n.toLocaleString('en-IN'));
  const bits = [];
  if (limits.max_teams !== undefined) bits.push(`${fmt(limits.max_teams)} teams`);
  if (limits.max_candidates !== undefined) bits.push(`${fmt(limits.max_candidates)} candidates`);
  return bits.join(' · ');
}

export function SignupPage() {
  const { signup, isAuthenticated, homePath } = useAuth();
  const navigate = useNavigate();
  const { data, loading: plansLoading, error: plansError } = useFetch('/api/v1/plans');

  const [planSlug, setPlanSlug] = useState('starter');
  const [form, setForm] = useState({ companyName: '', firstName: '', lastName: '', email: '', password: '', defaultCountry: 'IN' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to={homePath} replace />;

  const plans = (data?.plans || []).slice().sort((a, b) => Number(a.priceMonthly) - Number(b.priceMonthly));
  const selected = plans.find((p) => p.slug === planSlug);
  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup({ ...form, planSlug });
      // Session is already stored; '/' sends an org_admin to their dashboard.
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Create your workspace</CardTitle>
            <CardDescription>
              Free trial{selected ? ` for ${selected.trialDays} days` : ''}. No payment details needed today.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Label>Choose a plan</Label>
            {plansLoading && <p className="text-sm text-muted-foreground">Loading plans…</p>}
            {plansError && <p className="text-sm text-destructive">Couldn't load plans. You can still continue with Starter.</p>}
            <div className="grid gap-2" role="radiogroup" aria-label="Plan">
              {plans.map((p) => {
                const active = p.slug === planSlug;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPlanSlug(p.slug)}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                      active ? 'border-primary bg-accent/50 ring-2 ring-primary/30' : 'hover:bg-accent/30'
                    )}
                  >
                    <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border', active && 'border-primary bg-primary text-primary-foreground')}>
                      {active && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-sm font-medium">{formatMoney(p.priceMonthly)}<span className="text-xs text-muted-foreground">/mo</span></span>
                      </span>
                      <span className="block text-xs text-muted-foreground">{p.description}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{limitLine(p.limits)}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {(p.modules || []).slice(0, 6).map((m) => (
                          <span key={m} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{MODULE_LABELS[m] || m}</span>
                        ))}
                        {(p.modules || []).length > 6 && <span className="px-1 text-[11px] text-muted-foreground">+{p.modules.length - 6} more</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="grid gap-2">
              <Label htmlFor="companyName">Company name</Label>
              <Input id="companyName" value={form.companyName} onChange={update('companyName')} autoComplete="organization" required minLength={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" value={form.firstName} onChange={update('firstName')} autoComplete="given-name" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" value={form.lastName} onChange={update('lastName')} autoComplete="family-name" required />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={update('email')} autoComplete="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={form.password} onChange={update('password')} autoComplete="new-password" minLength={8} required />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="country">Country</Label>
              <NativeSelect id="country" value={form.defaultCountry} onChange={update('defaultCountry')}>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">Pre-fills phone country codes for your team.</p>
            </div>
            <ErrorNote>{error}</ErrorNote>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? 'Creating workspace…' : 'Start free trial'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-foreground underline underline-offset-4">Sign in</Link>
            </p>
          </CardFooter>
        </Card>
      </form>
    </AuthShell>
  );
}
