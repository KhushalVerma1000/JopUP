import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { Check, Circle, Eye, EyeOff, ArrowLeft, Loader2, ShieldCheck, CreditCard, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFetch, errorMessage } from '../hooks/useFetch';
import { AuthShell } from '../components/AuthShell';
import { formatMoney } from '../lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Every self-serve signup gets 30 days. A longer trial is granted by a platform
// admin to selected companies, so it is never offered or promised on this page.
const TRIAL_DAYS = 30;

const COUNTRIES = [
  ['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'United Arab Emirates'],
  ['SG', 'Singapore'], ['CA', 'Canada'], ['AU', 'Australia'],
];

// Best-effort country from the browser time zone; the user can change it.
const TZ_COUNTRY = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'Europe/London': 'GB', 'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
};
const browserTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

const MODULE_LABELS = {
  client_management: 'Clients', candidate_db: 'Candidates', job_posting: 'Job postings', workflow_engine: 'Workflows',
  pipeline_tracker: 'Pipeline tracker', kpi_engine: 'KPIs', performance_reviews: 'Reviews', strategy_planner: 'Strategy',
  job_portal: 'Job portal', analytics: 'Analytics', ai_screening: 'AI screening', sms_notifications: 'SMS',
};

const fmt = (n) => (n < 0 ? 'Unlimited' : Number(n).toLocaleString('en-IN'));
function limitLine(limits = {}) {
  const bits = [];
  if (limits.max_teams !== undefined) bits.push(`${fmt(limits.max_teams)} teams`);
  if (limits.max_candidates !== undefined) bits.push(`${fmt(limits.max_candidates)} candidates`);
  return bits.join(' · ');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RULES = [
  ['8+ characters', (p) => p.length >= 8],
  ['A letter', (p) => /[A-Za-z]/.test(p)],
  ['A number', (p) => /\d/.test(p)],
];

function validate(form) {
  const e = {};
  if (!form.firstName.trim()) e.firstName = 'Enter your first name';
  if (!form.lastName.trim()) e.lastName = 'Enter your last name';
  if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email, like name@company.com';
  if (form.password.length < 8) e.password = 'Use at least 8 characters';
  if (form.companyName.trim().length < 2) e.companyName = 'Enter your company name';
  return e;
}
const STEP_FIELDS = [['firstName', 'lastName', 'email', 'password'], ['companyName']];

function Field({ id, label, error, hint, children }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p id={`${id}-msg`} aria-live="polite" className={cn('min-w-0 break-words text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
        {error || hint}
      </p>
    </div>
  );
}

export function SignupPage() {
  const { signup, isAuthenticated, homePath } = useAuth();
  const navigate = useNavigate();
  const { data, loading: plansLoading, error: plansError } = useFetch('/api/v1/plans');
  const tz = useMemo(browserTimezone, []);
  const [params, setParams] = useSearchParams();
  const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;

  const [planSlug, setPlanSlug] = useState('starter');
  const [form, setForm] = useState({
    companyName: '', firstName: '', lastName: '', email: '', password: '',
    defaultCountry: TZ_COUNTRY[tz] || 'IN',
  });
  const [touched, setTouched] = useState({});
  const [showPw, setShowPw] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const topRef = useRef(null);

  // The step lives in the URL (?step=2) so Back/Forward move between steps.
  // Step 2 is only shown once step 1 is valid; a reload or a pasted link falls back to step 1.
  const step1Valid = STEP_FIELDS[0].every((f) => !validate(form)[f]);
  const step = params.get('step') === '2' && step1Valid ? 1 : 0;
  const dirty = !!(form.firstName || form.lastName || form.email || form.password || form.companyName);

  useEffect(() => {
    document.title = `${step === 0 ? 'Create your account' : 'Set up your workspace'} · HireTracker`;
  }, [step]);

  // Warn before a refresh or tab close throws away typed details.
  useEffect(() => {
    if (!dirty || submitting) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, submitting]);

  if (isAuthenticated) return <Navigate to={homePath} replace />;

  const plans = (data?.plans || []).slice().sort((a, b) => Number(a.priceMonthly) - Number(b.priceMonthly));
  const selected = plans.find((p) => p.slug === planSlug);
  const errors = validate(form);
  const update = (field) => (e) => { setError(null); setForm((f) => ({ ...f, [field]: e.target.value })); };
  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }));
  const show = (field) => (touched[field] ? errors[field] : undefined);
  const pwOk = RULES.map(([, test]) => test(form.password));
  const fieldProps = (field) => ({
    onBlur: blur(field), 'aria-invalid': !!show(field) || undefined, 'aria-describedby': `${field}-msg`,
  });

  // APG radio group: arrows move the selection and focus, Tab leaves the group.
  function onPlanKey(e) {
    const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!dir || !plans.length) return;
    e.preventDefault();
    const i = Math.max(0, plans.findIndex((p) => p.slug === planSlug));
    const next = plans[(i + dir + plans.length) % plans.length];
    setPlanSlug(next.slug);
    requestAnimationFrame(() => e.currentTarget.querySelector(`[data-plan="${next.slug}"]`)?.focus());
  }

  function goNext(e) {
    e.preventDefault();
    const bad = STEP_FIELDS[0].filter((f) => errors[f]);
    if (bad.length) {
      setTouched((t) => ({ ...t, ...Object.fromEntries(bad.map((f) => [f, true])) }));
      document.getElementById(bad[0])?.focus();
      return;
    }
    setParams({ step: '2' });
    topRef.current?.scrollIntoView({ block: 'start' });
    if (finePointer) setTimeout(() => document.getElementById('companyName')?.focus(), 0);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (errors.companyName) { setTouched((t) => ({ ...t, companyName: true })); document.getElementById('companyName')?.focus(); return; }
    setError(null);
    setSubmitting(true);
    try {
      // Trial length is not sent: the server decides it.
      await signup({
        ...form, companyName: form.companyName.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        email: form.email.trim(), planSlug, timezone: tz,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell wide>
      <div ref={topRef} className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[2fr_3fr] md:items-start">
        <aside className="order-2 flex flex-col gap-4 md:order-1 md:pt-2">
          <div>
            <span className="inline-block whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              {TRIAL_DAYS} day free trial
            </span>
            <h1 className="mt-3 text-balance text-2xl font-bold tracking-tight">Run your recruitment desk in one place</h1>
            <p className="mt-1 text-sm text-muted-foreground">Set up in about a minute. Invite your team after you are in.</p>
          </div>
          <ul className="grid gap-3 text-sm">
            <li className="flex gap-3"><CreditCard className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span><strong>No card needed.</strong> Nothing is charged during the trial.</span></li>
            <li className="flex gap-3"><Users className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span><strong>Full workspace.</strong> Clients, candidates, trackers and your team.</span></li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span><strong>Your data stays yours.</strong> If the trial ends, your data is kept and read-only until you upgrade.</span></li>
          </ul>
        </aside>

        <form onSubmit={step === 0 ? goNext : handleSubmit} noValidate aria-busy={submitting} className="order-1 touch-manipulation md:order-2">
          <Card>
            <CardHeader>
              <div className="mb-2 flex items-center gap-2" aria-label={`Step ${step + 1} of 2`}>
                {[0, 1].map((i) => (
                  <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors', i <= step ? 'bg-primary' : 'bg-muted')} />
                ))}
              </div>
              <CardTitle className="text-balance text-xl">{step === 0 ? 'Create your account' : 'Set up your workspace'}</CardTitle>
              <CardDescription>
                {step === 0 ? `Step 1 of 2 · Free for ${TRIAL_DAYS} days, no payment details.` : 'Step 2 of 2 · Last step.'}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {step === 0 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="firstName" label="First name" error={show('firstName')}>
                      <Input id="firstName" name="firstName" placeholder="e.g. Priya…" value={form.firstName} onChange={update('firstName')} autoComplete="given-name" autoFocus={finePointer} {...fieldProps('firstName')} />
                    </Field>
                    <Field id="lastName" label="Last name" error={show('lastName')}>
                      <Input id="lastName" name="lastName" placeholder="e.g. Sharma…" value={form.lastName} onChange={update('lastName')} autoComplete="family-name" {...fieldProps('lastName')} />
                    </Field>
                  </div>
                  <Field id="email" label="Work email" error={show('email')} hint="Use the email you will sign in with.">
                    <Input id="email" name="email" type="email" inputMode="email" placeholder="name@company.com…" autoCapitalize="none" spellCheck={false} value={form.email} onChange={update('email')} autoComplete="email" {...fieldProps('email')} />
                  </Field>
                  <Field id="password" label="Password" error={show('password')}>
                    <div className="relative">
                      <Input id="password" name="password" type={showPw ? 'text' : 'password'} value={form.password} onChange={update('password')} autoComplete="new-password" className="pr-11" {...fieldProps('password')} />
                      <button
                        type="button" onClick={() => setShowPw((v) => !v)}
                        aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Password checklist">
                      {RULES.map(([label], i) => (
                        <li key={label} className={cn('flex items-center gap-1', pwOk[i] ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                          {pwOk[i] ? <Check className="size-3" aria-hidden /> : <Circle className="size-3" aria-hidden />}
                          {label}<span className="sr-only">{pwOk[i] ? ', done' : ', not yet'}</span>
                        </li>
                      ))}
                    </ul>
                  </Field>
                </>
              )}

              {step === 1 && (
                <>
                  <Field id="companyName" label="Company name" error={show('companyName')}>
                    <Input id="companyName" name="organization" placeholder="e.g. Acme Staffing…" value={form.companyName} onChange={update('companyName')} autoComplete="organization" {...fieldProps('companyName')} />
                  </Field>
                  <Field id="country" label="Country" hint="Pre-fills phone country codes for your team.">
                    <NativeSelect id="country" name="country" autoComplete="country" value={form.defaultCountry} onChange={update('defaultCountry')}>
                      {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                    </NativeSelect>
                  </Field>

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label>Plan</Label>
                      {plans.length > 1 && (
                        <button type="button" onClick={() => setShowPlans((v) => !v)} className="min-h-11 text-xs font-medium text-primary underline-offset-4 hover:underline">
                          {showPlans ? 'Hide plans' : 'Compare plans'}
                        </button>
                      )}
                    </div>
                    {plansLoading && <p className="text-sm text-muted-foreground">Loading plans…</p>}
                    {plansError && <p className="text-sm text-muted-foreground">Couldn’t load plans. You’ll start on Starter and can change it later.</p>}

                    {!showPlans && selected && (
                      <div className="flex items-center justify-between gap-3 rounded-xl border bg-accent/30 p-3 text-sm">
                        <span className="min-w-0 truncate"><span className="font-semibold">{selected.name}</span> <span className="text-muted-foreground tabular-nums">· {limitLine(selected.limits)}</span></span>
                        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{formatMoney(selected.priceMonthly)}/mo after trial</span>
                      </div>
                    )}

                    {showPlans && (
                      <div className="grid gap-2" role="radiogroup" aria-label="Plan" onKeyDown={onPlanKey}>
                        {plans.map((p) => {
                          const active = p.slug === planSlug;
                          return (
                            <button
                              key={p.id} type="button" role="radio" aria-checked={active} tabIndex={active ? 0 : -1} data-plan={p.slug} onClick={() => setPlanSlug(p.slug)}
                              className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition-colors', active ? 'border-primary bg-accent/50 ring-2 ring-primary/30' : 'hover:bg-accent/30')}
                            >
                              <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border', active && 'border-primary bg-primary text-primary-foreground')}>
                                {active && <Check className="size-3" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline justify-between gap-2">
                                  <span className="font-semibold">{p.name}</span>
                                  <span className="text-sm font-medium tabular-nums">{formatMoney(p.priceMonthly)}<span className="text-xs text-muted-foreground">/mo after trial</span></span>
                                </span>
                                <span className="block text-xs text-muted-foreground">{p.description}</span>
                                <span className="mt-1 block text-xs tabular-nums text-muted-foreground">{limitLine(p.limits)}</span>
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
                    )}
                  </div>
                  <p aria-live="polite" className={cn('rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive', !error && 'hidden')}>{error}</p>
                </>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <div className="flex w-full gap-2">
                {step === 1 && (
                  <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)} disabled={submitting} aria-label="Back to step 1">
                    <ArrowLeft className="size-4" />
                  </Button>
                )}
                <Button type="submit" size="lg" className="flex-1" disabled={submitting}>
                  {submitting && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
                  {step === 0 ? 'Continue' : `Start ${TRIAL_DAYS}‑day free trial`}
                </Button>
              </div>
              {step === 1 && (
                <p className="text-center text-xs text-muted-foreground">No payment details needed today.</p>
              )}
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link to="/login" className="inline-block py-2 font-medium text-foreground underline underline-offset-4">Sign in</Link>
              </p>
            </CardFooter>
          </Card>
        </form>
      </div>
    </AuthShell>
  );
}
