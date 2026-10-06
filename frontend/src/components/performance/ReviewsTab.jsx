import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { ErrorNote, Loading, EmptyState, Sheet, Field, Fab, Avatar, Notice } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { fullName, shortDate } from '../../lib/format';

const RUBRIC = [['candidate_quality', 'Candidate quality'], ['pipeline_speed', 'Pipeline speed'], ['client_feedback', 'Client feedback']];
const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', acknowledged: 'Acknowledged' };
const STATUS_CLS = { draft: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300', submitted: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300', acknowledged: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' };

export function ReviewsTab({ teams, users, canWrite }) {
  const reviews = useFetch('/api/v1/performance/reviews');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const teamIds = useMemo(() => new Set(teams.map((t) => t.id)), [teams]);

  // The API already limits this list: managers see their teams' reviews, everyone else only their own submitted ones.
  const list = useMemo(() => (reviews.data?.reviews || []).filter((r) => teamIds.has(r.teamId)), [reviews.data, teamIds]);

  async function setStatus(r, status) {
    setBusyId(r.id); setActionError(null);
    try {
      if (status === 'acknowledged') await apiFetch(`/api/v1/performance/reviews/${r.id}/acknowledge`, { method: 'POST', body: {} });
      else await apiFetch(`/api/v1/performance/reviews/${r.id}`, { method: 'PATCH', body: { status } });
      await reviews.reload();
    }
    catch (err) { setActionError(errorMessage(err, 'We couldn’t update this review. Please try again.')); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <ErrorNote onRetry={reviews.reload}>{reviews.error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {reviews.loading && !reviews.data ? <Loading label="Loading reviews…" /> : list.length === 0 && !reviews.error ? (
        <EmptyState
          title="No reviews yet"
          body={canWrite ? 'Start a review for a team member. Drafts stay private until you submit them.' : 'Reviews your manager shares with you will appear here.'}
          action={canWrite && <Button onClick={() => setCreating(true)}><Plus /> Start a review</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((r) => {
            const score = r.averageScore;
            return (
              <Card key={r.id} className="gap-3 p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={r.revieweeName || 'Team member'} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{r.revieweeName || 'Team member'}</h3>
                    <p className="text-xs text-muted-foreground">{r.cycle}{r.submittedAt ? ` · submitted ${shortDate(r.submittedAt)}` : ''}</p>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CLS[r.status])}>{STATUS_LABEL[r.status]}</span>
                </div>
                {score !== null && (
                  <div className="grid gap-1 text-sm">
                    {RUBRIC.filter(([k]) => r.scores?.[k] != null).map(([k, label]) => (
                      <div key={k} className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{r.scores[k]}/5</span></div>
                    ))}
                    <div className="mt-1 flex justify-between border-t pt-1 font-medium"><span>Overall</span><span className="tabular-nums">{score.toFixed(1)}/5</span></div>
                  </div>
                )}
                {r.summary && <p className="text-sm text-muted-foreground">{r.summary}</p>}
                {r.managerNotes && <Notice title="Private notes (only you can see these)">{r.managerNotes}</Notice>}
                <div className="flex flex-wrap gap-2">
                  {r.canEdit && <Button size="sm" disabled={busyId === r.id} onClick={() => setStatus(r, 'submitted')}>Submit review</Button>}
                  {r.canAcknowledge && <Button size="sm" disabled={busyId === r.id} onClick={() => setStatus(r, 'acknowledged')}>Acknowledge</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {canWrite && list.length > 0 && <Fab icon={Plus} onClick={() => setCreating(true)}>New review</Fab>}
      <CreateReviewSheet open={creating} teams={teams} users={users} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reviews.reload(); }} />
    </>
  );
}

function CreateReviewSheet({ open, teams, users, onClose, onSaved }) {
  const blank = { teamId: '', revieweeId: '', cycle: '', summary: '', managerNotes: '', scores: {} };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const team = f.teamId || (teams.length === 1 ? teams[0].id : '');
  const people = users.filter((u) => u.roles?.some((r) => r.teamId === team && r.roleName === 'hr'));
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!team) { setError('Choose a team first.'); return; }
    if (!f.revieweeId) { setError('Choose who you’re reviewing.'); return; }
    if (!f.cycle.trim()) { setError('Add the review period, e.g. “Q3 2026”.'); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch('/api/v1/performance/reviews', {
        method: 'POST',
        body: { teamId: team, revieweeId: f.revieweeId, cycle: f.cycle.trim(), scores: f.scores, summary: f.summary.trim() || undefined, managerNotes: f.managerNotes.trim() || undefined },
      });
      setF(blank); onSaved();
    } catch (err) { setError(errorMessage(err, 'We couldn’t save this review. Please try again.')); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Start a review" description="It’s saved as a draft. The person can’t see it until you submit it.">
      <form onSubmit={submit} className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        {teams.length > 1 && (
          <Field label="Team" htmlFor="rt"><NativeSelect id="rt" value={team} onChange={set('teamId')}><option value="">Select a team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
        )}
        <Field label="Reviewing" htmlFor="rr"><NativeSelect id="rr" value={f.revieweeId} onChange={set('revieweeId')}><option value="">Select a person</option>{people.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}</NativeSelect></Field>
        <Field label="Review period" htmlFor="rc"><Input id="rc" placeholder="Q3 2026" value={f.cycle} onChange={set('cycle')} /></Field>
        {RUBRIC.map(([key, label]) => (
          <Field key={key} label={`${label} (1–5)`} htmlFor={`rs-${key}`}>
            <NativeSelect id={`rs-${key}`} value={f.scores[key] ?? ''} onChange={(e) => setF((s) => ({ ...s, scores: { ...s.scores, [key]: e.target.value ? Number(e.target.value) : undefined } }))}>
              <option value="">Not scored</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </NativeSelect>
          </Field>
        ))}
        <Field label="Summary (shared with them)" htmlFor="rsum"><Textarea id="rsum" rows={3} value={f.summary} onChange={set('summary')} /></Field>
        <Field label="Private notes" htmlFor="rn" hint="Only managers can see these."><Textarea id="rn" rows={2} value={f.managerNotes} onChange={set('managerNotes')} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</Button>
      </form>
    </Sheet>
  );
}
