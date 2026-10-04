import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Sheet, ErrorNote, Field, Notice } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { buildUpdateText, copyStageLabel, runAndCopy } from '../../lib/clipboard';
import { errorMessage } from '../../hooks/useFetch';
import { cn } from '@/lib/utils';

export const QUICK_STATUSES = ['Reached', 'On the way', 'Not reachable', 'Not interested', 'Rescheduled'];

/**
 * The stage-update dialog. HR picks the stage and (optionally) a status such
 * as "Reached"; the dialog shows exactly what will be copied. One tap moves
 * the candidate and — only if the move worked — copies name, mobile,
 * location, position, stage and status, ready to paste into the group chat.
 */
export function StageUpdateSheet({ tracker, stages, defaultStageId, onClose, onConfirm }) {
  const [stageId, setStageId] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [outcome, setOutcome] = useState(null); // null | { copied }
  const closeTimer = useRef(null);

  useEffect(() => {
    if (tracker) { setStageId(defaultStageId || ''); setStatus(''); setError(null); setOutcome(null); setBusy(false); }
    return () => clearTimeout(closeTimer.current);
  }, [tracker, defaultStageId]);

  const currentIdx = stages.findIndex((s) => s.id === tracker?.currentStage?.id);
  // Forward only — the server rejects anything else.
  const choices = stages.filter((_, i) => i > currentIdx);
  const stage = stages.find((s) => s.id === stageId);

  const text = useMemo(() => (tracker ? buildUpdateText({
    name: tracker.candidateName,
    phone: tracker.candidatePhone,
    location: tracker.candidateLocation,
    position: tracker.openPositionDesignation,
    stage: stage ? copyStageLabel(stage.stageKey, stage.name) : undefined,
    status: status.trim(),
  }) : ''), [tracker, stage, status]);

  async function submit(e) {
    e.preventDefault();
    if (!stage || busy) return;
    setBusy(true);
    setError(null);
    // Started inside the tap on purpose: runAndCopy needs the user gesture.
    const result = await runAndCopy(onConfirm({ stage, note: status.trim() || undefined }), text);
    if (!result.moved) {
      setBusy(false);
      setError(`${errorMessage(result.error, `Couldn't move ${tracker.candidateName} to ${stage.name}.`)} ${result.copied ? 'Nothing was changed, so ignore the text that was just copied.' : 'Nothing was copied.'}`);
      return;
    }
    setOutcome({ copied: result.copied });
    if (result.copied) closeTimer.current = setTimeout(onClose, 900);
    else setBusy(false);
  }

  const done = !!outcome;

  return (
    <Sheet open={!!tracker} onClose={onClose} title={`Move ${tracker?.candidateName || ''}`}>
      <form className="flex flex-col gap-4" onSubmit={done ? (e) => { e.preventDefault(); onClose(); } : submit}>
        <Field label="Move to stage" htmlFor="su-stage">
          <NativeSelect id="su-stage" value={stageId} onChange={(e) => setStageId(e.target.value)} disabled={done} required>
            {choices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </Field>

        <Field label="Status (optional)" htmlFor="su-status">
          <div className="flex flex-wrap gap-2">
            {QUICK_STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={status === s} disabled={done} onClick={() => setStatus(status === s ? '' : s)}
                className={cn('h-10 rounded-full border px-3 text-sm disabled:opacity-50', status === s ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground')}>{s}</button>
            ))}
          </div>
          <Input id="su-status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={done} placeholder="Or type your own, e.g. Reached at 3 pm" maxLength={500} autoComplete="off" />
        </Field>

        <div className="grid gap-1">
          <span id="su-preview-label" className="text-xs font-medium text-muted-foreground">Text to copy</span>
          <pre aria-labelledby="su-preview-label" className="select-all whitespace-pre-wrap rounded-md border bg-muted/50 p-3 text-sm leading-relaxed">{text}</pre>
        </div>

        <ErrorNote>{error}</ErrorNote>
        {done && !outcome.copied && (
          <Notice tone="warn" title={`Moved to ${stage?.name}, but your browser blocked copying`}>Press and hold the text above to copy it.</Notice>
        )}
        <Button type="submit" size="lg" disabled={busy || !stage}>
          {done ? (outcome.copied ? 'Moved & copied ✓' : 'Done') : <><Copy /> {busy ? 'Moving…' : `Move to ${stage?.name || '…'} & copy details`}</>}
        </Button>
      </form>
    </Sheet>
  );
}
