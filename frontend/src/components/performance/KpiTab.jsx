import { useMemo, useState } from 'react';
import { Plus, ArrowUpRight, ArrowDownRight, PencilLine, RefreshCw } from 'lucide-react';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { Section, ErrorNote, Loading, EmptyState, Sheet, Field, Chips, Fab } from '@/components/common';
import { Sparkline } from '../charts';
import { MetricSelect, AutoBadge } from './MetricSelect';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { FREQUENCY_LABEL, DIRECTION_LABEL, TONE_TEXT, formatValue, todayInput } from '../../lib/kpi';

function KpiCard({ kpi, canWrite, onRecord, onRecompute }) {
  const { latest, recent, health, changePct: delta, improving } = kpi;
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 truncate text-sm font-semibold"><span className="truncate">{kpi.name}</span>{kpi.isAuto && <AutoBadge />}</h3>
          <p className="truncate text-xs text-muted-foreground">{kpi.teamName} · {FREQUENCY_LABEL[kpi.frequency]}{kpi.category ? ` · ${kpi.category}` : ''}</p>
        </div>
        <Sparkline values={recent.map((p) => p.value)} tone={health.tone} />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{formatValue(latest?.value ?? null, kpi.unit)}</div>
          <div className="text-xs text-muted-foreground">
            {kpi.targetValue != null ? `Target ${formatValue(kpi.targetValue, kpi.unit)}` : 'No target set'}
            {latest && ` · ${latest.periodLabel}`}
          </div>
          {latest?.overridden && <div className="text-xs text-amber-700 dark:text-amber-400" title={latest.overrideReason || ''}>Adjusted by hand (system had {formatValue(latest.computedValue, kpi.unit)})</div>}
        </div>
        <div className="text-right">
          <div className={cn('text-xs font-medium', TONE_TEXT[health.tone])}>{health.label}</div>
          {delta !== null && (
            <div className={cn('flex items-center justify-end gap-0.5 text-xs tabular-nums', improving === null ? 'text-muted-foreground' : improving ? TONE_TEXT.good : TONE_TEXT.bad)}>
              {delta >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
              {Math.abs(delta).toFixed(0)}% vs last period
            </div>
          )}
        </div>
      </div>

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onRecord(kpi)}>
            <PencilLine /> {kpi.isAuto ? 'Override value' : 'Record value'}
          </Button>
          {kpi.isAuto && <Button variant="ghost" size="sm" onClick={() => onRecompute(kpi)}><RefreshCw /> Recompute</Button>}
        </div>
      )}
    </Card>
  );
}

export function KpiTab({ teams, canWrite }) {
  const kpis = useFetch('/api/v1/performance/kpis');
  const [teamId, setTeamId] = useState('');
  const [recording, setRecording] = useState(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState(null);

  async function recompute(kpi) {
    setNotice(null);
    try { await apiFetch(`/api/v1/performance/kpis/${kpi.id}/recompute`, { method: 'POST' }); kpis.reload(); }
    catch (err) { setNotice(errorMessage(err, 'We couldn’t recompute this KPI. Please try again.')); }
  }

  const inScope = useMemo(() => new Set(teamId ? [teamId] : teams.map((t) => t.id)), [teamId, teams]);
  const list = useMemo(() => (kpis.data?.kpis || []).filter((k) => inScope.has(k.teamId)), [kpis.data, inScope]);

  const noData = !kpis.loading && !kpis.error && list.length === 0;

  return (
    <>
      {teams.length > 1 && <Chips className="mb-4" items={[{ key: '', label: 'All teams' }, ...teams.map((t) => ({ key: t.id, label: t.name }))]} value={teamId} onChange={setTeamId} />}
      <ErrorNote onRetry={kpis.reload}>{kpis.error}</ErrorNote>
      <ErrorNote>{notice}</ErrorNote>
      {kpis.loading && !kpis.data ? <Loading label="Loading KPIs…" /> : noData ? (
        <EmptyState
          title="No KPIs yet"
          body={canWrite ? 'Pick what your team is measured on. KPIs built from the pipeline fill themselves in, so there is nothing to type each period.' : 'Your manager hasn’t set up any KPIs for your team yet.'}
          action={canWrite && <Button onClick={() => setCreating(true)}><Plus /> Add a KPI</Button>}
        />
      ) : (
        <Section>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((k) => (
              <KpiCard key={k.id} kpi={k} canWrite={canWrite} onRecord={setRecording} onRecompute={recompute} />
            ))}
          </div>
        </Section>
      )}

      {canWrite && list.length > 0 && <Fab icon={Plus} onClick={() => setCreating(true)}>Add KPI</Fab>}
      <RecordSheet kpi={recording} onClose={() => setRecording(null)} onSaved={() => { setRecording(null); kpis.reload(); }} />
      <CreateKpiSheet open={creating} teams={teams} defaultTeam={teamId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); kpis.reload(); }} />
    </>
  );
}

function RecordSheet({ kpi, onClose, onSaved }) {
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayInput());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [forId, setForId] = useState(null);

  // Reset whenever a different KPI is opened.
  if (kpi && forId !== kpi.id) {
    setForId(kpi.id); setValue(''); setNotes(''); setError(null);
    setDate(kpi.isAuto && kpi.latest?.periodDate ? kpi.latest.periodDate : todayInput()); setLabel('');
  }
  if (!kpi && forId) setForId(null);

  async function revert() {
    setBusy(true); setError(null);
    try { await apiFetch(`/api/v1/performance/kpi-entries/${kpi.latest.id}/override`, { method: 'DELETE' }); onSaved(); }
    catch (err) { setError(errorMessage(err, 'We couldn’t restore the computed value. Please try again.')); }
    finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    const n = Number(value);
    if (value === '' || Number.isNaN(n)) { setError('Enter a number for this period’s value.'); return; }
    if (kpi.isAuto && !notes.trim()) { setError('Say why you are changing the computed value, so anyone reading it knows.'); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch('/api/v1/performance/kpi-entries', {
        method: 'POST',
        body: { kpiId: kpi.id, value: n, periodLabel: label.trim() || undefined, periodDate: date || undefined, notes: notes.trim() || undefined },
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'We couldn’t save this value. Check your connection and try again.'));
    } finally { setBusy(false); }
  }

  return (
    <Sheet open={!!kpi} onClose={onClose} title={kpi ? `${kpi.isAuto ? 'Override' : 'Record'} ${kpi.name}` : ''} description={kpi?.isAuto ? 'This KPI is computed from the pipeline. Only override it when the system can’t see something, and say why.' : kpi?.targetValue != null ? `Target: ${formatValue(kpi.targetValue, kpi.unit)}` : undefined}>
      <form onSubmit={submit} className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        {kpi?.latest?.overridden && (
          <Button type="button" variant="outline" disabled={busy} onClick={revert}>Go back to the computed value ({formatValue(kpi.latest.computedValue, kpi.unit)})</Button>
        )}
        <Field label={`Value${kpi?.unit ? ` (${kpi.unit})` : ''}`} htmlFor="kv"><Input id="kv" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Period name (optional)" htmlFor="kp" hint="Leave blank to use the month, week or quarter of the date below."><Input id="kp" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Period start date" htmlFor="kd" hint="Recording the same period again replaces the earlier value."><Input id="kd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={kpi?.isAuto ? 'Reason' : 'Note (optional)'} htmlFor="kn"><Textarea id="kn" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : kpi?.isAuto ? 'Save override' : 'Save value'}</Button>
      </form>
    </Sheet>
  );
}

function CreateKpiSheet({ open, teams, defaultTeam, onClose, onSaved }) {
  const blank = { mode: 'auto', metricKey: '', name: '', teamId: '', unit: '', frequency: 'monthly', targetValue: '', direction: 'higher_better', category: '', description: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const team = f.teamId || defaultTeam || (teams.length === 1 ? teams[0].id : '');

  async function submit(e) {
    e.preventDefault();
    if (f.mode === 'auto' && !f.metricKey) { setError('Choose what this KPI should measure.'); return; }
    if (f.mode === 'manual' && !f.name.trim()) { setError('Give this KPI a name, e.g. “Client satisfaction”.'); return; }
    if (!team) { setError('Choose which team this KPI belongs to.'); return; }
    if (f.targetValue !== '' && Number.isNaN(Number(f.targetValue))) { setError('Target must be a number.'); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch('/api/v1/performance/kpis', {
        method: 'POST',
        body: f.mode === 'auto'
          ? { metricKey: f.metricKey, teamId: team, name: f.name.trim() || undefined, frequency: f.frequency, category: f.category.trim() || undefined, targetValue: f.targetValue === '' ? undefined : Number(f.targetValue) }
          : {
            source: 'manual', name: f.name.trim(), teamId: team, frequency: f.frequency, direction: f.direction,
            unit: f.unit.trim() || undefined, category: f.category.trim() || undefined, description: f.description.trim() || undefined,
            targetValue: f.targetValue === '' ? undefined : Number(f.targetValue),
          },
      });
      setF(blank);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'We couldn’t create this KPI. Please try again.'));
    } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a KPI" description={f.mode === 'auto' ? 'Pick what to measure. The numbers fill themselves in from the pipeline.' : 'For things the pipeline can’t see. You’ll record a value each period.'}>
      <form onSubmit={submit} className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Chips items={[{ key: 'auto', label: 'Automatic' }, { key: 'manual', label: 'Enter by hand' }]} value={f.mode} onChange={(mode) => setF((s) => ({ ...s, mode }))} />
        {f.mode === 'auto' ? (
          <MetricSelect id="km" value={f.metricKey} onChange={(metricKey) => setF((s) => ({ ...s, metricKey }))} />
        ) : (
          <Field label="Name" htmlFor="kn1"><Input id="kn1" autoFocus placeholder="Client satisfaction" value={f.name} onChange={set('name')} /></Field>
        )}
        {teams.length > 1 && (
          <Field label="Team" htmlFor="kt">
            <NativeSelect id="kt" value={team} onChange={set('teamId')}>
              <option value="">Select a team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target" htmlFor="kg"><Input id="kg" inputMode="decimal" value={f.targetValue} onChange={set('targetValue')} /></Field>
          {f.mode === 'manual' && <Field label="Unit" htmlFor="ku" hint="%, days, count…"><Input id="ku" value={f.unit} onChange={set('unit')} /></Field>}
        </div>
        <Field label={f.mode === 'auto' ? 'Measured per' : 'How often will you record it?'} htmlFor="kf">
          <NativeSelect id="kf" value={f.frequency} onChange={set('frequency')}>
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </Field>
        {f.mode === 'manual' && (
          <Field label="What counts as good?" htmlFor="kdir">
            <NativeSelect id="kdir" value={f.direction} onChange={set('direction')}>
              {Object.entries(DIRECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </Field>
        )}
        {f.mode === 'auto' && <Field label="Name (optional)" htmlFor="kn2" hint="Leave blank to use the metric’s name."><Input id="kn2" value={f.name} onChange={set('name')} /></Field>}
        <Field label="Category (optional)" htmlFor="kc"><Input id="kc" placeholder="Recruitment" value={f.category} onChange={set('category')} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create KPI'}</Button>
      </form>
    </Sheet>
  );
}
