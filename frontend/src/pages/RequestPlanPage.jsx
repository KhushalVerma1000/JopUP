import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Loader2, MailCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFetch, errorMessage } from '../hooks/useFetch';
import { apiFetch } from '../lib/api';
import { AuthShell } from '../components/AuthShell';
import { formatMoney } from '../lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_SIZES = ['1–10 people', '11–50 people', '51–200 people', '200+ people'];

// One page, two doors: /enterprise-trial (Enterprise is requested, never self-serve)
// and /upgrade (Pro, until online payment exists).
const COPY = {
  enterprise: {
    slug: 'enterprise', plan: 'Enterprise',
    title: 'Request an Enterprise trial',
    lead: 'Enterprise is set up with you, so it is not self-serve. Tell us about your team and we will reply by email.',
    cta: 'Request trial',
    done: 'Your request is in. We will reply to the email you gave. Your free trial keeps running in the meantime.',
  },
  pro: {
    slug: 'pro', plan: 'Pro',
    title: 'Get Pro',
    lead: 'Online payment is coming soon. Tell us you want Pro and we will switch it on for your workspace.',
    cta: 'Tell us I want Pro',
    done: 'Thanks. We will reply to the email you gave and set Pro up for you. Nothing is charged until you agree.',
  },
};

function validate(f) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Enter your name';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid work email, like name@company.com';
  if (f.company.trim().length < 2) e.company = 'Enter your company name';
  return e;
}

function Field({ id, label, error, hint, children }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p id={`${id}-msg`} aria-live="polite" className={cn('min-w-0 break-words text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>{error || hint}</p>
    </div>
  );
}

export function RequestPlanPage() {
  const { pathname } = useLocation();
  const { user, isAuthenticated, homePath } = useAuth();
  const c = pathname.startsWith('/upgrade') ? COPY.pro : COPY.enterprise;
  const plans = useFetch('/api/v1/plans');
  const planRow = (plans.data?.plans || []).find((p) => p.slug === c.slug);

  const [form, setForm] = useState({
    name: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '',
    email: user?.email || '', company: '', phone: '', teamSize: '', message: '', website: '',
  });
  const [touched, setTouched] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const errors = validate(form);

  useEffect(() => { document.title = `${c.title} · HireTracker`; }, [c.title]);

  const update = (k) => (e) => { setError(null); setForm((f) => ({ ...f, [k]: e.target.value })); };
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const show = (k) => (touched[k] ? errors[k] : undefined);
  const props = (k) => ({ onBlur: blur(k), 'aria-invalid': !!show(k) || undefined, 'aria-describedby': `${k}-msg` });

  async function submit(e) {
    e.preventDefault();
    const bad = Object.keys(errors);
    if (bad.length) {
      setTouched((t) => ({ ...t, ...Object.fromEntries(bad.map((k) => [k, true])) }));
      document.getElementById(bad[0])?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/trial-requests', {
        method: 'POST',
        body: {
          plan: c.slug, name: form.name.trim(), email: form.email.trim(), company: form.company.trim(),
          phone: form.phone.trim() || undefined, teamSize: form.teamSize || undefined,
          message: form.message.trim() || undefined, website: form.website,
        },
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not send your request. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const back = isAuthenticated ? { to: homePath, label: 'Back to your workspace' } : { to: '/signup', label: 'Start the free trial instead' };

  if (sent) {
    return (
      <AuthShell>
        <Card>
          <CardHeader>
            <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-accent text-primary"><MailCheck className="size-5" aria-hidden /></span>
            <CardTitle className="text-balance text-xl">Request received</CardTitle>
            <CardDescription>{c.done}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" size="lg" className="w-full"><Link to={back.to}>{back.label}</Link></Button>
          </CardFooter>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit} noValidate aria-busy={busy} className="touch-manipulation">
        <Card>
          <CardHeader>
            <CardTitle className="text-balance text-xl">{c.title}</CardTitle>
            <CardDescription>{c.lead}</CardDescription>
            {planRow && (
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{planRow.name}</span> · <span className="tabular-nums">{formatMoney(planRow.priceMonthly)}/mo</span>
                {Number(planRow.creditAllowance) > 0 && <> · <span className="tabular-nums">{Number(planRow.creditAllowance).toLocaleString('en-IN')}</span> credits a month</>}
              </p>
            )}
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <Field id="name" label="Your name" error={show('name')}>
              <Input id="name" name="name" autoComplete="name" placeholder="e.g. Priya Sharma…" value={form.name} onChange={update('name')} {...props('name')} />
            </Field>
            <Field id="email" label="Work email" error={show('email')} hint="We reply here.">
              <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="name@company.com…" value={form.email} onChange={update('email')} {...props('email')} />
            </Field>
            <Field id="company" label="Company" error={show('company')}>
              <Input id="company" name="organization" autoComplete="organization" placeholder="e.g. Acme Staffing…" value={form.company} onChange={update('company')} {...props('company')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="teamSize" label="Team size (optional)">
                <NativeSelect id="teamSize" name="teamSize" value={form.teamSize} onChange={update('teamSize')}>
                  <option value="">Choose…</option>
                  {TEAM_SIZES.map((t) => <option key={t} value={t}>{t}</option>)}
                </NativeSelect>
              </Field>
              <Field id="phone" label="Phone (optional)">
                <Input id="phone" name="tel" type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. +91 98765 43210…" value={form.phone} onChange={update('phone')} />
              </Field>
            </div>
            <Field id="message" label="Anything we should know? (optional)">
              <Textarea id="message" name="message" rows={3} maxLength={1000} placeholder="e.g. 3 teams, 40 recruiters, hiring for BFSI clients…" value={form.message} onChange={update('message')} />
            </Field>

            {/* Honeypot: invisible to people, tempting to bots. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Website<input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={update('website')} /></label>
            </div>

            <p aria-live="polite" className={cn('rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive', !error && 'hidden')}>{error}</p>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
              {c.cta}
            </Button>
            <ul className="grid gap-1 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />Your free trial keeps running while we reply.</li>
              <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />No card needed.</li>
            </ul>
            <Link to={back.to} className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline">{back.label}</Link>
          </CardFooter>
        </Card>
      </form>
    </AuthShell>
  );
}
