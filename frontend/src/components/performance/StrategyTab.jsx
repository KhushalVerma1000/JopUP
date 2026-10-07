import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { ErrorNote, Loading, EmptyState, Sheet, Field, Fab, Bar, Chips } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { KR_STATUS, TONE_TEXT, formatValue } from '../../lib/kpi';
import { shortDate } from '../../lib/format';
import { MetricSelect, AutoBadge } from './MetricSelect';

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
                <p className="text-xs text-muted-foreground">
                  {s.period}{s.window ? ` (${shortDate(s.window.start)} – ${shortDate(s.window.end)})` : ''} · {STATUS_LABEL[s.status]} · {s.teamName}{s.progressPct !== null ? ` · ${s.progressPct}% overall` : ''}{s.isFinal ? ' · results locked' : ''}
                </p>
              </div>
              {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
              {(s.objectives || []).map((o, i) => (
                <div key={i} className="grid gap-2 border-t pt-3">
                  <p className="text-sm font-medium">{o.objective}{o.progressPct !== null && o.progressPct !== undefined ? <span className="font-normal text-muted-foreground"> · {o.progressPct}%</span> : null}</p>
                  {(o.key_results || []).map((kr, j) => {
                    const st = KR_STATUS[kr.status] || KR_STATUS.no_data;
                    return (
                      <div key={j} className="grid gap-1">
                        <div className="flex justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-2"><span className="truncate">{kr.kr}</span>{kr.source === 'auto' && <AutoBadge />}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{formatValue(kr.current ?? null, kr.unit)} / {formatValue(kr.target, kr.unit)}</span>
                        </div>
                        <Bar value={kr.progressPct ?? 0} max={100} label={kr.kr} />
                        <div className={cn('text-[11px]', TONE_TEXT[st.tone])}>{kr.note || st.label}</div>
                      </div>
                    );
                  })}
                  {s.retrospective && <p className="text-xs text-muted-foreground">Retrospective: {s.retrospective}</p>}
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
  const emptyKr = () => ({ kr: '', target: '', mode: 'auto', metricKey: '' });
  const blank = { title: '', period: '', startDate: '', endDate: '', teamId: '', objective: '', krs: [emptyKr(), emptyKr()] };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const team = f.teamId || (teams.length === 1 ? teams[0].id : '');
  const metrics = useFetch('/api/v1/performance/metrics');
  const metricName = (key) => (metrics.data?.metrics || []).find((m) => m.key === key)?.label || key;
  const setKr = (i, k, v) => setF((s) => ({ ...s, krs: s.krs.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));

  async function submit(e) {
    e.preventDefault();
    if (!f.title.trim() || !f.period.trim()) { setError('Add a title and a period, e.g. “Q4 2026”.'); return; }
    if (!team) { setError('Choose which team this is for.'); return; }
    const krs = f.krs.filter((r) => r.kr.trim() || r.metricKey);
    if (krs.some((r) => Number.isNaN(Number(r.target)) || r.target === '')) { setError('Every key result needs a numeric target.'); return; }
    if (krs.some((r) => r.mode === 'auto' && !r.metricKey)) { setError('Choose a metric for each automatic key result, or switch it to “By hand”.'); return; }
    if ((f.startDate && !f.endDate) || (!f.startDate && f.endDate)) { setError('Give both a start and an end date, or leave both blank.'); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch('/api/v1/performance/strategies', {
        method: 'POST',
        body: {
          teamId: team, title: f.title.trim(), period: f.period.trim(), status: 'active',
          startDate: f.startDate || undefined, endDate: f.endDate || undefined,
          objectives: f.objective.trim() ? [{
            objective: f.objective.trim(),
            key_results: krs.map((r) => (r.mode === 'auto'
              ? { kr: r.kr.trim() || metricName(r.metricKey), target: Number(r.target), type: 'metric', metric_key: r.metricKey }
              : { kr: r.kr.trim(), target: Number(r.target), type: 'manual', current: 0 })),
          }] : [],
        },
      });
      setF(blank); onSaved();
    } catch (err) { setError(errorMessage(err, 'We couldn’t save this strategy. Please try again.')); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add an objective" description="Key results measured from the pipeline update themselves. Use “By hand” only for things the pipeline can’t see.">
      <form onSubmit={submit} className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Title" htmlFor="st"><Input id="st" autoFocus placeholder="Grow placements" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Period" htmlFor="sp" hint="Quarters, halves, months and years like “Q4 2026” are read automatically. For anything else, add dates below."><Input id="sp" placeholder="Q4 2026" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts (optional)" htmlFor="ssd"><Input id="ssd" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Ends (optional)" htmlFor="sed"><Input id="sed" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        {teams.length > 1 && (
          <Field label="Team" htmlFor="stm"><NativeSelect id="stm" value={team} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">Select a team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
        )}
        <Field label="Objective" htmlFor="so"><Input id="so" placeholder="Double our placement rate" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></Field>
        {f.krs.map((r, i) => (
          <div key={i} className="grid gap-3 rounded-lg border p-3">
            <Chips items={[{ key: 'auto', label: 'From pipeline' }, { key: 'manual', label: 'By hand' }]} value={r.mode} onChange={(v) => setKr(i, 'mode', v)} />
            {r.mode === 'auto' && <MetricSelect id={`km${i}`} label={`Key result ${i + 1} is measured by`} value={r.metricKey} onChange={(v) => setKr(i, 'metricKey', v)} />}
            <div className="grid grid-cols-[1fr_5.5rem] gap-3">
              <Field label={r.mode === 'auto' ? 'Label (optional)' : `Key result ${i + 1}`} htmlFor={`kr${i}`}><Input id={`kr${i}`} placeholder="Place 40 candidates" value={r.kr} onChange={(e) => setKr(i, 'kr', e.target.value)} /></Field>
              <Field label="Target" htmlFor={`kt${i}`}><Input id={`kt${i}`} inputMode="decimal" value={r.target} onChange={(e) => setKr(i, 'target', e.target.value)} /></Field>
            </div>
          </div>
        ))}
        {f.krs.length < 4 && <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setF((s) => ({ ...s, krs: [...s.krs, emptyKr()] }))}><Plus /> Add key result</Button>}
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save objective'}</Button>
      </form>
    </Sheet>
  );
}
