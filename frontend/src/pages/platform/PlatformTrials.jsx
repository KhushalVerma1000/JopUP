import { useEffect, useState } from 'react';
import { Trash2, Plus, Loader2, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '../../components/AppLayout';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { PageHeader, ErrorNote, Loading, Section, Notice, StatusPill } from '@/components/common';
import { NativeSelect } from '@/components/ui/native-select';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { relativeTime } from '../../lib/format';


const PLAN_LABEL = { enterprise: 'Enterprise trial', pro: 'Pro upgrade' };

/**
 * One request. Enterprise: pick the trial length and approve (switches their
 * workspace onto Enterprise). Pro: no payment yet, so it is only marked contacted.
 */
function RequestRow({ r, onChanged, onError }) {
  const [days, setDays] = useState(30);
  const [orgId, setOrgId] = useState(r.workspaces.length === 1 ? r.workspaces[0].id : '');
  const [busy, setBusy] = useState(false);
  const enterprise = r.plan === 'enterprise';
  const noWorkspace = r.workspaces.length === 0;

  async function act(path, body) {
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/api/v1/platform/trial-requests/${r.id}/${path}`, { method: 'POST', body });
      await onChanged();
    } catch (err) {
      onError(errorMessage(err, 'Could not update this request.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{r.company} <span className="font-normal text-muted-foreground">· {r.name}</span></div>
          <div className="truncate text-xs text-muted-foreground"><a className="underline-offset-4 hover:underline" href={`mailto:${r.email}`}>{r.email}</a>{r.phone ? ` · ${r.phone}` : ''}{r.teamSize ? ` · ${r.teamSize}` : ''} · {relativeTime(r.createdAt)}</div>
        </div>
        <StatusPill status={enterprise ? 'trialing' : 'active'}>{PLAN_LABEL[r.plan] || r.plan}</StatusPill>
      </div>
      {r.message && <p className="whitespace-pre-line break-words text-sm text-muted-foreground">{r.message}</p>}

      {enterprise && noWorkspace && (
        <Notice tone="warn">No workspace uses this email yet. Ask them to sign up first (it is free), then approve.</Notice>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {enterprise && !noWorkspace && r.workspaces.length > 1 && (
          <div className="grid gap-1">
            <Label htmlFor={`ws-${r.id}`} className="text-xs">Workspace</Label>
            <NativeSelect id={`ws-${r.id}`} value={orgId} onChange={(e) => setOrgId(e.target.value)} className="min-w-44">
              <option value="">Choose…</option>
              {r.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </NativeSelect>
          </div>
        )}
        {enterprise && !noWorkspace && r.workspaces.length === 1 && (
          <Link to={`/platform/organizations/${r.workspaces[0].id}`} className="min-h-11 content-center text-sm text-primary underline-offset-4 hover:underline">{r.workspaces[0].name}</Link>
        )}
        {enterprise && !noWorkspace && (
          <div className="grid gap-1">
            <Label htmlFor={`days-${r.id}`} className="text-xs">Trial days</Label>
            <Input id={`days-${r.id}`} type="number" inputMode="numeric" min={7} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-24 tabular-nums" />
          </div>
        )}
        {enterprise && !noWorkspace && (
          <Button disabled={busy || (r.workspaces.length > 1 && !orgId)} onClick={() => act('approve', { days: Number(days), organisationId: orgId || undefined })}>
            {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Check aria-hidden />} Approve
          </Button>
        )}
        {!enterprise && (
          <Button variant="outline" disabled={busy} onClick={() => act('contacted', {})}><Check aria-hidden /> Mark contacted</Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => act('decline', {})}><X aria-hidden /> Decline</Button>
      </div>
    </div>
  );
}

function PlanRequests() {
  const { data, loading, error, reload } = useFetch('/api/v1/platform/trial-requests?status=all');
  const [actionError, setActionError] = useState(null);
  const list = data?.requests || [];
  const pending = list.filter((r) => r.status === 'pending');
  const handled = list.filter((r) => r.status !== 'pending').slice(0, 10);

  return (
    <>
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      <Section title={`Requests (${pending.length})`} hint="Enterprise trials and Pro upgrades people asked for.">
        <Card className="mb-6 divide-y p-0">
          {loading && !data && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
          {data && pending.length === 0 && <p className="p-4 text-sm text-muted-foreground">No requests waiting.</p>}
          {pending.map((r) => <RequestRow key={r.id} r={r} onChanged={reload} onError={setActionError} />)}
        </Card>
      </Section>
      {handled.length > 0 && (
        <Section title="Recently handled">
          <Card className="mb-6 divide-y p-0">
            {handled.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.company} <span className="font-normal text-muted-foreground">· {PLAN_LABEL[r.plan] || r.plan}</span></div>
                  <div className="truncate text-xs text-muted-foreground">{r.email} · {relativeTime(r.handledAt)}{r.status === 'approved' && r.trialDays ? ` · ${r.trialDays} days` : ''}</div>
                </div>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">{r.status}</span>
              </div>
            ))}
          </Card>
        </Section>
      )}
    </>
  );
}

/**
 * Platform admins pick the companies that get the 90-day trial. Everyone else
 * gets 30 days. Add an exact email, or a company domain (acme.com) to cover
 * the first signup from that company. A row is used up by one signup.
 */
export function PlatformTrials() {
  const { data, loading, error, reload } = useFetch('/api/v1/platform/trial-selections');
  const [match, setMatch] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => { document.title = 'Trials & requests · HireTracker'; }, []);

  const list = data?.selections || [];
  const waiting = list.filter((s) => !s.claimedAt);
  const used = list.filter((s) => s.claimedAt);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await apiFetch('/api/v1/platform/trial-selections', { method: 'POST', body: { match, note: note || undefined } });
      setMatch('');
      setNote('');
      await reload();
    } catch (err) {
      setFormError(errorMessage(err, 'Could not add this company.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(s) {
    if (!window.confirm(`Remove ${s.match}? Their signup will get the standard 30-day trial.`)) return;
    setActionError(null);
    try {
      await apiFetch(`/api/v1/platform/trial-selections/${s.id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not remove this entry.'));
    }
  }

  return (
    <AppLayout wide>
      <PageHeader
        title="Trials & requests"
        subtitle="Approve Enterprise requests. Everyone gets 30 days; companies you select get 90 days when they sign up."
      />
      <PlanRequests />
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>

      <Card className="mb-6 p-4">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="match">Email or company domain</Label>
            <Input id="match" name="match" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="e.g. hr@acme.com or acme.com…" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" name="note" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why they were selected…" maxLength={200} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Plus aria-hidden />} Select company</Button>
        </form>
        <p aria-live="polite" className="mt-2 break-words text-sm text-destructive">{formError}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          A domain entry works for one signup from that company. Public mail domains (like gmail.com) cannot be selected; add the exact email instead.
          Already signed up? Open the organisation and use “Grant 90-day trial”.
        </p>
      </Card>

      {loading && !data && <Loading />}

      <Section title={`Waiting for signup (${waiting.length})`}>
        <Card className="divide-y p-0">
          {waiting.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nobody waiting.</p>}
          {waiting.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.match}</div>
                <div className="truncate text-xs text-muted-foreground">{s.note || 'No note'} · added {relativeTime(s.createdAt)}</div>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Remove ${s.match}`} onClick={() => remove(s)}><Trash2 /></Button>
            </div>
          ))}
        </Card>
      </Section>

      <Section title={`Signed up (${used.length})`}>
        <Card className="divide-y p-0">
          {used.length === 0 && <p className="p-4 text-sm text-muted-foreground">No selected company has signed up yet.</p>}
          {used.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.match}</div>
                <div className="truncate text-xs text-muted-foreground">Signed up {relativeTime(s.claimedAt)}</div>
              </div>
              {s.claimedOrg && (
                <Link to={`/platform/organizations/${s.claimedOrg.id}`} className="shrink-0 text-sm text-primary underline-offset-4 hover:underline">{s.claimedOrg.name}</Link>
              )}
            </div>
          ))}
        </Card>
      </Section>
    </AppLayout>
  );
}
