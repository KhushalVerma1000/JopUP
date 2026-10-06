import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { ErrorNote, Loading, EmptyState, Sheet, Field, Chips, Fab, Bar, StatusPill } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { fullName, shortDate } from '../../lib/format';

const FILTERS = [{ key: 'active', label: 'Active' }, { key: 'overdue', label: 'Overdue' }, { key: 'completed', label: 'Completed' }, { key: 'all', label: 'All' }];

export function GoalsTab({ teams, users, canWrite }) {
  const goals = useFetch('/api/v1/performance/goals');
  const [filter, setFilter] = useState('active');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const teamIds = useMemo(() => new Set(teams.map((t) => t.id)), [teams]);
  const all = useMemo(() => (goals.data?.goals || []).filter((g) => teamIds.has(g.teamId)), [goals.data, teamIds]);
  const shown = all.filter((g) => filter === 'all' || g.effectiveStatus === filter);
  const count = (k) => all.filter((g) => g.effectiveStatus === k).length;

  return (
    <>
      <Chips className="mb-4" value={filter} onChange={setFilter} items={FILTERS.map((f) => ({ ...f, count: f.key === 'all' ? all.length : count(f.key) }))} />
      <ErrorNote onRetry={goals.reload}>{goals.error}</ErrorNote>
      {goals.loading && !goals.data ? <Loading label="Loading goals…" /> : shown.length === 0 && !goals.error ? (
        <EmptyState
          title={filter === 'all' ? 'No goals yet' : `No ${filter} goals`}
          body={canWrite ? 'Set a goal for your team or a teammate and track progress toward it.' : 'Goals your manager sets for you will show up here.'}
          action={canWrite && filter === 'all' && <Button onClick={() => setCreating(true)}><Plus /> Set a goal</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((g) => (
            <Card key={g.id} className="gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{g.title}</h3>
                  <p className="text-xs text-muted-foreground">{g.assignedToName || 'Whole team'}{g.dueDate ? ` · due ${shortDate(g.dueDate)}` : ''}</p>
                </div>
                <StatusPill status={g.effectiveStatus === 'overdue' ? 'on_hold' : g.effectiveStatus === 'completed' ? 'active' : g.effectiveStatus}>{g.effectiveStatus}</StatusPill>
              </div>
              {g.description && <p className="text-sm text-muted-foreground">{g.description}</p>}
              <div className="flex items-center gap-3">
                <Bar value={g.progressPct} max={100} label={`${g.title} progress`} tone={g.effectiveStatus === 'overdue' ? 'warn' : 'primary'} />
                <span className="w-10 text-right text-sm tabular-nums">{g.progressPct}%</span>
              </div>
              {(canWrite || g.isMine) && g.status !== 'completed' && g.status !== 'cancelled' && (
                <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setEditing(g)}>Update progress</Button>
              )}
            </Card>
          ))}
        </div>
      )}
      {canWrite && all.length > 0 && <Fab icon={Plus} onClick={() => setCreating(true)}>Set goal</Fab>}
      <ProgressSheet goal={editing} canWrite={canWrite} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); goals.reload(); }} />
      <CreateGoalSheet open={creating} teams={teams} users={users} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); goals.reload(); }} />
    </>
  );
}

function ProgressSheet({ goal, canWrite, onClose, onSaved }) {
  const [pct, setPct] = useState(0);
  const [forId, setForId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (goal && forId !== goal.id) { setForId(goal.id); setPct(goal.progressPct); setError(null); }
  if (!goal && forId) setForId(null);

  async function save(markDone) {
    setBusy(true); setError(null);
    try {
      // Managers edit the goal; the person it's assigned to reports their own progress.
      if (canWrite) await apiFetch(`/api/v1/performance/goals/${goal.id}`, { method: 'PATCH', body: markDone ? { progressPct: 100, status: 'completed' } : { progressPct: pct } });
      else await apiFetch(`/api/v1/performance/goals/${goal.id}/progress`, { method: 'PATCH', body: { progressPct: markDone ? 100 : pct, complete: markDone || undefined } });
      onSaved();
    } catch (err) { setError(errorMessage(err, 'We couldn’t update this goal. Please try again.')); } finally { setBusy(false); }
  }

  return (
    <Sheet open={!!goal} onClose={onClose} title="Update progress" description={goal?.title}>
      <div className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label={`Progress: ${pct}%`} htmlFor="gp">
          <input id="gp" type="range" min="0" max="100" step="5" value={pct} onChange={(e) => setPct(Number(e.target.value))} className="h-11 w-full accent-primary" />
        </Field>
        <Button disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save progress'}</Button>
        <Button variant="outline" disabled={busy} onClick={() => save(true)}>Mark as completed</Button>
      </div>
    </Sheet>
  );
}

function CreateGoalSheet({ open, teams, users, onClose, onSaved }) {
  const blank = { title: '', teamId: '', assignedTo: '', dueDate: '', description: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const team = f.teamId || (teams.length === 1 ? teams[0].id : '');
  const people = users.filter((u) => u.roles?.some((r) => r.teamId === team));

  async function submit(e) {
    e.preventDefault();
    if (!f.title.trim()) { setError('Describe the goal in a few words, e.g. “Place 10 candidates by March”.'); return; }
    if (!team) { setError('Choose which team this goal is for.'); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch('/api/v1/performance/goals', {
        method: 'POST',
        body: { teamId: team, title: f.title.trim(), description: f.description.trim() || undefined, assignedTo: f.assignedTo || undefined, dueDate: f.dueDate || undefined },
      });
      setF(blank); onSaved();
    } catch (err) { setError(errorMessage(err, 'We couldn’t save this goal. Please try again.')); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Set a goal" description="Leave “Assign to” empty to make it a team goal.">
      <form onSubmit={submit} className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Goal" htmlFor="gt"><Input id="gt" autoFocus value={f.title} onChange={set('title')} /></Field>
        {teams.length > 1 && (
          <Field label="Team" htmlFor="gtm"><NativeSelect id="gtm" value={team} onChange={set('teamId')}><option value="">Select a team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
        )}
        <Field label="Assign to (optional)" htmlFor="ga">
          <NativeSelect id="ga" value={f.assignedTo} onChange={set('assignedTo')}><option value="">Whole team</option>{people.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}</NativeSelect>
        </Field>
        <Field label="Due date (optional)" htmlFor="gd"><Input id="gd" type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Details (optional)" htmlFor="gdesc"><Textarea id="gdesc" rows={3} value={f.description} onChange={set('description')} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save goal'}</Button>
      </form>
    </Sheet>
  );
}
