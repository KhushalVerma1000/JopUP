import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { ErrorNote, Loading, EmptyState, Sheet, Field, Fab, Bar } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

const STATUS_LABEL = { draft: 'Draft', active: 'Active', archived: 'Archived' };

export function StrategyTab({ teams, canWrite }) {
  const strategies = useFetch('/api/v1/performance/strategies');
  const [creating, setCreating] = useState(false);
  const teamIds = useMemo(() => new Set(teams.map((t) => t.id)), [teams]);
  const list = useMemo(() => (strategies.data?.strategies || []).filter((s) => teamIds.has(s.teamId) && s.status !== 'archived'), [strategies.data, teamIds]);

  return (
    <>
      <ErrorNote onRetry={strategies.reload}>{strategies.error}</ErrorNote>
      {strategies.loading && !strategies.data ? <Loading label="Loading strategy…" /> : list.length === 0 && !strategies.error ? (
        <EmptyState
          title="No strategy for this period"
          body={canWrite ? 'Write an objective with measurable key results so the team knows what success looks like.' : 'Your manager’s objectives for the team will appear here.'}
          action={canWrite && <Button onClick={() => setCreating(true)}><Plus /> Add an objective</Button>}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((s) => (
            <Card key={s.id} className="gap-3 p-4">
              <div>
                <h3 className="text-sm font-semibold">{s.title}</h3>
                <p className="text-xs text-muted-foreground">{s.period} · {STATUS_LABEL[s.status]} · {s.teamName}{s.progressPct !== null ? ` · ${s.progressPct}% overall` : ''}</p>
              </div>
              {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
              {(s.objectives || []).map((o, i) => (
                <div key={i} className="grid gap-2 border-t pt-3">
                  <p className="text-sm font-medium">{o.objective}</p>
                  {(o.key_results || []).map((kr, j) => (
                    <div key={j} className="grid gap-1">
                      <div className="flex justify-between gap-2 text-xs"><span>{kr.kr}</span><span className="shrink-0 tabular-nums text-muted-foreground">{kr.current ?? 0}/{kr.target}</span></div>
                      <Bar value={kr.current ?? 0} max={kr.target || 1} label={kr.kr} />
                    </div>
                  ))}
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
      {canWrite && list.length > 0 && <Fab icon={Plus} onClick={() => setCreating(true)}>Add objective</Fab>}
      <CreateStrategySheet open={creating} teams={teams} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); strategies.reload(); }} />
    </>
  );
}

function CreateStrategySheet({ open, teams, onClose, onSaved }) {
  const blank = { title: '', period: '', teamId: '', objective: '', krs: [{ kr: '', target: '' }, { kr: '', target: '' }] };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const team = f.teamId || (teams.length === 1 ? teams[0].id : '');
  const setKr = (i, k, v) => setF((s) => ({ ...s, krs: s.krs.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));

  async function submit(e) {
    e.preventDefault();
    if (!f.title.trim() || !f.period.trim()) { setError('Add a title and a period, e.g. “Q4 2026”.'); return; }
    if (!team) { setError('Choose which team this is for.'); return; }
    const krs = f.krs.filter((r) => r.kr.trim());
    if (krs.some((r) => Number.isNaN(Number(r.target)) || r.target === '')) { setError('Every key result needs a numeric target.'); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch('/api/v1/performance/strategies', {
        method: 'POST',
        body: {
          teamId: team, title: f.title.trim(), period: f.period.trim(), status: 'active',
          objectives: f.objective.trim() ? [{ objective: f.objective.trim(), key_results: krs.map((r) => ({ kr: r.kr.trim(), target: Number(r.target), current: 0 })) }] : [],
        },
      });
      setF(blank); onSaved();
    } catch (err) { setError(errorMessage(err, 'We couldn’t save this strategy. Please try again.')); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add an objective" description="One objective with up to two measurable key results.">
      <form onSubmit={submit} className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Title" htmlFor="st"><Input id="st" autoFocus placeholder="Grow placements" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Period" htmlFor="sp"><Input id="sp" placeholder="Q4 2026" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
        {teams.length > 1 && (
          <Field label="Team" htmlFor="stm"><NativeSelect id="stm" value={team} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">Select a team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
        )}
        <Field label="Objective" htmlFor="so"><Input id="so" placeholder="Double our placement rate" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></Field>
        {f.krs.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_5.5rem] gap-3">
            <Field label={`Key result ${i + 1}`} htmlFor={`kr${i}`}><Input id={`kr${i}`} placeholder="Place 40 candidates" value={r.kr} onChange={(e) => setKr(i, 'kr', e.target.value)} /></Field>
            <Field label="Target" htmlFor={`kt${i}`}><Input id={`kt${i}`} inputMode="decimal" value={r.target} onChange={(e) => setKr(i, 'target', e.target.value)} /></Field>
          </div>
        ))}
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save objective'}</Button>
      </form>
    </Sheet>
  );
}
