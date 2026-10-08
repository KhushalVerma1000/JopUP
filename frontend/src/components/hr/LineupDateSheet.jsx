import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Sheet, ErrorNote, Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '../../hooks/useFetch';
import { dayKey, timeKey, toIso, todayKey } from '../../lib/lineupDay';

/**
 * Sets (or clears) the day a candidate is lined up. Everything that follows —
 * the pipeline's date filter and the lineup mail — reads this one value.
 */
export function LineupDateSheet({ tracker, onClose, onSave }) {
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (tracker) { setDay(dayKey(tracker.lineupDate)); setTime(timeKey(tracker.lineupDate)); setError(null); setBusy(false); }
  }, [tracker]);

  async function save(iso) {
    setBusy(true);
    setError(null);
    try { await onSave(iso); onClose(); }
    catch (err) { setError(errorMessage(err, 'Could not save the lineup date.')); setBusy(false); }
  }

  return (
    <Sheet open={!!tracker} onClose={onClose} title={`Lineup date — ${tracker?.candidateName || ''}`}
      description="The day this candidate is lined up with the client. The pipeline can be filtered by it, and the lineup mail uses it.">
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (day) save(toIso(day, time)); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day" htmlFor="ld-day"><Input id="ld-day" type="date" value={day} min={todayKey(-30)} onChange={(e) => setDay(e.target.value)} required autoFocus /></Field>
          <Field label="Time (optional)" htmlFor="ld-time"><Input id="ld-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-2">
          {tracker?.lineupDate && <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => save(null)}>Clear date</Button>}
          <Button type="submit" className="flex-1" disabled={busy || !day}><CalendarClock /> {busy ? 'Saving…' : 'Save lineup date'}</Button>
        </div>
      </form>
    </Sheet>
  );
}
