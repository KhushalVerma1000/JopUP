import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Sheet, ErrorNote, StatusPill, Loading, Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { can } from '../../lib/roles';
import { relativeTime } from '../../lib/format';

/**
 * Job postings are the *portal-facing* side of a position, so they live under
 * Positions rather than as a primary tab: a position is the demand HR works;
 * a posting is just how that demand is advertised.
 *
 * Controlled: PositionsTab owns the fetch and the open/closed state so that
 * creating a posting can reload the list and reveal it.
 */
export function JobPostingsSection({ jobs: jobsFetch, positions, open, onToggle }) {
  const { roles } = useAuth();
  const { data, loading, error, reload } = jobsFetch;
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const canPublish = can(roles, 'job_postings', 'publish');
  const canClose = can(roles, 'job_postings', 'close');
  const jobs = data?.jobs || [];
  const posById = new Map(positions.map((p) => [p.id, p]));

  async function act(job, action) {
    setBusyId(job.id);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/job-postings/${job.id}/${action}`, { method: 'POST' });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, `Could not ${action} this posting.`));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-8">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-accent/40">
        <span>
          <span className="block text-sm font-semibold">Job portal postings</span>
          <span className="block text-xs text-muted-foreground">{jobs.length} posting{jobs.length === 1 ? '' : 's'} advertising your positions</span>
        </span>
        <ChevronDown className={`size-5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="mt-3">
          <ErrorNote onRetry={reload}>{error}</ErrorNote>
          <ErrorNote>{actionError}</ErrorNote>
          {loading && !data && <Loading />}
          {data && jobs.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No postings yet. Use “Post job” on a position to advertise it.</p>}
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {jobs.map((j) => (
              <Card key={j.id} className="gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{j.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {j.openPositionId && posById.get(j.openPositionId) ? `Advertises: ${posById.get(j.openPositionId).designation}` : 'Not linked to a position'}
                    </div>
                  </div>
                  <StatusPill status={j.status} />
                </div>
                <div className="text-xs text-muted-foreground">{j.publishedAt ? `Published ${relativeTime(j.publishedAt)}` : 'Not published yet'}</div>
                <div className="flex gap-2">
                  {canPublish && ['draft', 'paused'].includes(j.status) && <Button className="flex-1" disabled={busyId === j.id} onClick={() => act(j, 'publish')}>Publish</Button>}
                  {canClose && j.status === 'published' && <Button className="flex-1" variant="outline" disabled={busyId === j.id} onClick={() => act(j, 'close')}>Close posting</Button>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Create a draft posting that advertises one open position. */
export function PostJobSheet({ position, onClose, onCreated }) {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/job-postings', {
        method: 'POST',
        body: {
          title: position.designation,
          description: description.trim(),
          teamId: position.teamId,
          clientId: position.clientId || undefined,
          openPositionId: position.id,
          location: position.location || undefined,
          vacancies: position.vacancies || undefined,
        },
      });
      setDescription('');
      onCreated(position);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the posting.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!position} onClose={onClose} title={`Post job: ${position?.designation || ''}`}
      description="This creates a draft linked to the position. Nothing goes live until you publish it.">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Job description" htmlFor="pj-desc">
          <Textarea id="pj-desc" value={description} onChange={(e) => setDescription(e.target.value)} required rows={5} autoFocus />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" size="lg" disabled={busy || !description.trim()}>{busy ? 'Creating…' : 'Create draft posting'}</Button>
      </form>
    </Sheet>
  );
}
