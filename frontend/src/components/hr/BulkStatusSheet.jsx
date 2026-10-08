import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Sheet, ErrorNote, Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { apiFetch } from '../../lib/api';
import { errorMessage } from '../../hooks/useFetch';
import { copyStageLabel } from '../../lib/clipboard';
import { BulkResult } from './BulkResult';

const VERB = { advance: 'move', hold: 'be put on hold', resume: 'be resumed', block: 'be rejected' };

/**
 * Move, hold, resume or reject everyone selected. Same two steps as the dates
 * sheet: Preview (server dry run) then Apply. Each candidate is checked on its
 * own — one who changed under you is reported, and the rest still go through.
 * `allowed` says which actions this role may use; `stageOptions` are the stages
 * of the workflow most of the selection is on.
 */
export function BulkStatusSheet({ trackers, allowed, stageOptions, onClose, onApplied }) {
  const actions = [['advance', 'Move to a stage'], ['hold', 'Put on hold'], ['resume', 'Resume'], ['block', 'Reject']].filter(([k]) => allowed[k]);
  const [action, setAction] = useState('advance');
  const [stageId, setStageId] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [final, setFinal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const open = !!trackers;

  useEffect(() => {
    if (open) { setAction(actions[0]?.[0] || 'advance'); setStageId(''); setNote(''); setReason(''); setPreview(null); setFinal(null); setError(null); setBusy(false); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPreview(null); }, [action, stageId, note, reason]);

  const valid = action === 'advance' ? !!stageId : action === 'block' ? !!reason.trim() : true;
  const body = (dryRun) => ({
    trackerIds: (trackers || []).map((t) => t.id), action, dryRun,
    ...(action === 'advance' ? { nextStageId: stageId, ...(note.trim() ? { note: note.trim() } : {}) } : {}),
    ...(action === 'block' ? { reason: reason.trim() } : {}),
  });

  async function run(dryRun) {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch('/api/v1/trackers/bulk/status', { method: 'POST', body: body(dryRun) });
      if (dryRun) setPreview(res.data); else { setFinal(res.data); onApplied(res.data); }
    } catch (err) { setError(errorMessage(err, 'Could not update the candidates.')); }
    setBusy(false);
  }

  const result = final || preview;
  const picked = stageOptions.find((s) => s.id === stageId);

  return (
    <Sheet open={open} onClose={onClose} title={`Update status — ${trackers?.length || 0} selected`}
      description="Preview first. Nothing changes until you press Apply.">
      <div className="flex flex-col gap-4">
        {!final && (
          <>
            <Field label="What to do" htmlFor="bs-action">
              <NativeSelect id="bs-action" value={action} onChange={(e) => setAction(e.target.value)}>
                {actions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </NativeSelect>
            </Field>
            {action === 'advance' && (
              <>
                <Field label="Move to" htmlFor="bs-stage">
                  <NativeSelect id="bs-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                    <option value="">Choose a stage…</option>
                    {stageOptions.map((s) => <option key={s.id} value={s.id}>{copyStageLabel(s.stageKey, s.name)}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Status note (optional)" htmlFor="bs-note">
                  <Input id="bs-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reached" />
                </Field>
                <p className="text-xs text-muted-foreground">Candidates already at or past {picked?.name || 'this stage'}, or on hold, are skipped.</p>
              </>
            )}
            {action === 'block' && (
              <Field label="Reason" htmlFor="bs-reason">
                <Input id="bs-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Salary expectation too high" />
              </Field>
            )}
          </>
        )}

        <BulkResult result={result} done={!!final} noun={VERB[action]} detail={(a) => (a.toStage ? `→ ${a.toStage}` : '')} />
        <ErrorNote>{error}</ErrorNote>

        <div className="flex gap-2">
          {final ? (
            <Button className="flex-1" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" className="flex-1" disabled={busy || !valid} onClick={() => run(true)}>{busy && !preview ? 'Checking…' : 'Preview'}</Button>
              <Button type="button" variant={action === 'block' ? 'destructive' : 'default'} className="flex-1" disabled={busy || !preview || preview.applied.length === 0} onClick={() => run(false)}>
                {busy && preview ? 'Applying…' : <>{action === 'advance' && <ArrowRight />} Apply to {preview?.applied.length ?? 0}</>}
              </Button>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
