import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Sheet, ErrorNote, Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { apiFetch } from '../../lib/api';
import { errorMessage } from '../../hooks/useFetch';
import { toIso, todayKey, lineupLabel } from '../../lib/lineupDay';
import { BulkResult } from './BulkResult';

const MODES = [['same', 'Same time for everyone'], ['stagger', 'One after another'], ['clear', 'Clear the date']];

/**
 * Set or clear the lineup / interview date for everyone selected, in one go.
 * Two steps on purpose: Preview asks the server what would change (nothing is
 * written), Apply does it. `trackers` is a snapshot in the order shown on screen,
 * which is the order "one after another" follows.
 */
export function BulkDatesSheet({ trackers, defaultField = 'lineupDate', onClose, onApplied }) {
  const [field, setField] = useState(defaultField);
  const [mode, setMode] = useState('same');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [gap, setGap] = useState('30');
  const [preview, setPreview] = useState(null);
  const [final, setFinal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const open = !!trackers;

  useEffect(() => {
    if (open) { setField(defaultField); setMode('same'); setDay(''); setTime(''); setGap('30'); setPreview(null); setFinal(null); setError(null); setBusy(false); }
  }, [open, defaultField]);
  // Any change to the form makes an earlier preview stale.
  useEffect(() => { setPreview(null); }, [field, mode, day, time, gap]);

  const gapNum = Number(gap);
  const valid = mode === 'clear' || (!!day && (mode === 'same' || (!!time && gapNum >= 1 && gapNum <= 480)));
  const body = (dryRun) => ({
    trackerIds: (trackers || []).map((t) => t.id), field, mode, dryRun,
    ...(mode === 'same' ? { at: toIso(day, time) } : mode === 'stagger' ? { start: toIso(day, time), gapMinutes: gapNum } : {}),
  });

  async function run(dryRun) {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch('/api/v1/trackers/bulk/dates', { method: 'POST', body: body(dryRun) });
      if (dryRun) setPreview(res.data); else { setFinal(res.data); onApplied(res.data); }
    } catch (err) { setError(errorMessage(err, 'Could not update the dates.')); }
    setBusy(false);
  }

  const label = field === 'lineupDate' ? 'lineup date' : 'interview date';
  const result = final || preview;
  const detail = (a) => (a.value ? lineupLabel(a.value) : 'Date cleared');

  return (
    <Sheet open={open} onClose={onClose} title={`Set dates — ${trackers?.length || 0} selected`}
      description="Preview first. Nothing changes until you press Apply.">
      <div className="flex flex-col gap-4">
        {!final && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Which date" htmlFor="bd-field">
                <NativeSelect id="bd-field" value={field} onChange={(e) => setField(e.target.value)}>
                  <option value="lineupDate">Lineup date</option><option value="interviewDate">Interview date</option>
                </NativeSelect>
              </Field>
              <Field label="How" htmlFor="bd-mode">
                <NativeSelect id="bd-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                  {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </Field>
            </div>
            {mode !== 'clear' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Day" htmlFor="bd-day"><Input id="bd-day" type="date" value={day} min={todayKey(-30)} onChange={(e) => setDay(e.target.value)} /></Field>
                <Field label={mode === 'stagger' ? 'First candidate at' : 'Time (optional)'} htmlFor="bd-time"><Input id="bd-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
              </div>
            )}
            {mode === 'stagger' && (
              <Field label="Minutes between candidates" htmlFor="bd-gap">
                <Input id="bd-gap" type="number" inputMode="numeric" min={1} max={480} value={gap} onChange={(e) => setGap(e.target.value)} />
              </Field>
            )}
            <p className="text-xs text-muted-foreground">
              {mode === 'stagger' ? 'Candidates follow the order on your screen. Joined or rejected candidates are skipped and don’t take a slot.'
                : mode === 'clear' ? `Removes the ${label} from everyone selected.`
                  : `Everyone selected gets the same ${label}. Leave the time empty to set only the day.`}
            </p>
          </>
        )}

        <BulkResult result={result} done={!!final} noun={mode === 'clear' ? 'be cleared' : 'be set'} detail={detail} />
        <ErrorNote>{error}</ErrorNote>

        <div className="flex gap-2">
          {final ? (
            <Button className="flex-1" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" className="flex-1" disabled={busy || !valid} onClick={() => run(true)}>{busy && !preview ? 'Checking…' : 'Preview'}</Button>
              <Button type="button" className="flex-1" disabled={busy || !preview || preview.applied.length === 0} onClick={() => run(false)}>
                <CalendarClock /> {busy && preview ? 'Applying…' : `Apply to ${preview?.applied.length ?? 0}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
