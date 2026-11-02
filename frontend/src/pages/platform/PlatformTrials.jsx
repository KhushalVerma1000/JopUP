import { useEffect, useState } from 'react';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '../../components/AppLayout';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { PageHeader, ErrorNote, Loading, Section } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { relativeTime } from '../../lib/format';

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

  useEffect(() => { document.title = '90-day trials · HireTracker'; }, []);

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
        title="90-day trials"
        subtitle="Everyone gets 30 days. Companies you select here get 90 days when they sign up."
      />
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
