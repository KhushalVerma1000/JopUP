import { useMemo, useState } from 'react';
import { Plus, ArrowUpRight, ArrowDownRight, PencilLine } from 'lucide-react';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { Section, ErrorNote, Loading, EmptyState, Sheet, Field, Chips, Fab } from '@/components/common';
import { Sparkline } from '../charts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { FREQUENCY_LABEL, DIRECTION_LABEL, TONE_TEXT, formatValue, todayInput } from '../../lib/kpi';

function KpiCard({ kpi, canWrite, onRecord }) {
  const { latest, recent, health, changePct: delta, improving } = kpi;
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{kpi.name}</h3>
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
        <Button variant="outline" size="sm" className="justify-self-start" onClick={() => onRecord(kpi)}>
          <PencilLine /> Record value
        </Button>
      )}
    </Card>
  );
}

export function KpiTab({ teams, canWrite }) {
  const kpis = useFetch('/api/v1/performance/kpis');
  const [teamId, setTeamId] = useState('');
  const [recording, setRecording] = useState(null);
  const [creating, setCreating] = useState(false);

  const inScope = useMemo(() => new Set(teamId ? [teamId] : teams.map((t) => t.id)), [teamId, teams]);
  const list = useMemo(() => (kpis.data?.kpis || []).filter((k) => inScope.has(k.teamId)), [kpis.data, inScope]);

  const noData = !kpis.loading && !kpis.error && list.length === 0;

  return (
    <>
      {teams.length > 1 && <Chips className="mb-4" items={[{ key: '', label: 'All teams' }, ...teams.map((t) => ({ key: t.id, label: t.name }))]} value={teamId} onChange={setTeamId} />}
      <ErrorNote onRetry={kpis.reload}>{kpis.error}</ErrorNote>
      {kpis.loading && !kpis.data ? <Loading label="Loading KPIs…" /> : noData ? (
        <EmptyState
          title="No KPIs yet"
          body={canWrite ? 'Add the numbers your team is measured on, then record a value each period to see trends.' : 'Your manager hasn’t set up any KPIs for your team yet.'}
          action={canWrite && <Button onClick={() => setCreating(true)}><Plus /> Add a KPI</Button>}
        />
      ) : (
        <Section>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((k) => (
              <KpiCard key={k.id} kpi={k} canWrite={canWrite} onRecord={setRecording} />
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
    setDate(todayInput()); setLabel('');
  }
  if (!kpi && forId) setForId(null);

  async function submit(e) {
    e.preventDefault();
    const n = Number(value);
    if (value === '' || Number.isNaN(n)) { setError('Enter a number for this period’s value.'); return; }
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
    <Sheet open={!!kpi} onClose={onClose} title={kpi ? `Record ${kpi.name}` : ''} description={kpi?.targetValue != null ? `Target: ${formatValue(kpi.targetValue, kpi.unit)}` : undefined}>
      <form onSubmit={submit} className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label={`Value${kpi?.unit ? ` (${kpi.unit})` : ''}`} htmlFor="kv"><Input id="kv" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Period name (optional)" htmlFor="kp" hint="Leave blank to use the month, week or quarter of the date below."><Input id="kp" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Period start date" htmlFor="kd" hint="Recording the same period again replaces the earlier value."><Input id="kd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Note (optional)" htmlFor="kn"><Textarea id="kn" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save value'}</Button>
      </form>
    </Sheet>
  );
}

function CreateKpiSheet({ open, teams, defaultTeam, onClose, onSaved }) {
  const blank = { name: '', teamId: '', unit: '', frequency: 'monthly', targetValue: '', direction: 'higher_better', category: '', description: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const team = f.teamId || defaultTeam || (teams.length === 1 ? teams[0].id : '');

  async function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) { setError('Give this KPI a name, e.g. “Placements per month”.'); return; }
    if (!team) { setError('Choose which team this KPI belongs to.'); return; }
    if (f.targetValue !== '' && Number.isNaN(Number(f.targetValue))) { setError('Target must be a number.'); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch('/api/v1/performance/kpis', {
        method: 'POST',
        body: {
          name: f.name.trim(), teamId: team, frequency: f.frequency, direction: f.direction,
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
    <Sheet open={open} onClose={onClose} title="Add a KPI" description="Pick something you can measure the same way every period.">
      <form onSubmit={submit} className="grid gap-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Name" htmlFor="kn1"><Input id="kn1" autoFocus placeholder="Placements per month" value={f.name} onChange={set('name')} /></Field>
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
          <Field label="Unit" htmlFor="ku" hint="%, days, count…"><Input id="ku" value={f.unit} onChange={set('unit')} /></Field>
        </div>
        <Field label="How often will you record it?" htmlFor="kf">
          <NativeSelect id="kf" value={f.frequency} onChange={set('frequency')}>
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </Field>
        <Field label="What counts as good?" htmlFor="kdir">
          <NativeSelect id="kdir" value={f.direction} onChange={set('direction')}>
            {Object.entries(DIRECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Category (optional)" htmlFor="kc"><Input id="kc" placeholder="Recruitment" value={f.category} onChange={set('category')} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create KPI'}</Button>
      </form>
    </Sheet>
  );
}
