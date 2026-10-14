import { useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { Sheet, ErrorNote, Field, Notice, Loading, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';

const slot = (r) => `${r.trigger}:${r.triggerKey}`;

/** Managers decide which actions move a candidate forward on their own. HR just sees the result in the stage note. */
export function AutomationTab() {
  const rules = useFetch('/api/v1/automation/rules');
  const options = useFetch('/api/v1/automation/options');
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const list = rules.data || [];
  const triggers = options.data?.triggers || [];
  const stages = options.data?.stages || [];
  const triggerLabel = (r) => triggers.find((t) => slot({ trigger: t.trigger, triggerKey: t.key }) === slot(r))?.label || r.triggerKey;
  const stageName = (key) => stages.find((s) => s.key === key)?.name || key;
  const taken = new Set(list.map(slot));
  const starters = (options.data?.suggested || []).filter((s) => !taken.has(slot(s)));

  async function run(fn, fallback) {
    setBusy(true); setError(null);
    try { await fn(); await rules.reload(); setEdit(null); } catch (err) { setError(errorMessage(err, fallback)); } finally { setBusy(false); }
  }
  const create = (body) => run(() => apiFetch('/api/v1/automation/rules', { method: 'POST', body }), 'Could not save the rule.');
  const toggle = (r) => run(() => apiFetch(`/api/v1/automation/rules/${r.id}`, { method: 'PATCH', body: { isEnabled: !r.isEnabled } }), 'Could not update the rule.');
  const remove = (r) => {
    if (!window.confirm(`Delete "${r.name}"? Candidates will no longer move automatically for this.`)) return;
    run(() => apiFetch(`/api/v1/automation/rules/${r.id}`, { method: 'DELETE' }), 'Could not delete the rule.');
  };

  function openNew() {
    const free = triggers.find((t) => !taken.has(slot({ trigger: t.trigger, triggerKey: t.key })));
    setError(null);
    setEdit({ trigger: free?.trigger || 'date_set', triggerKey: free?.key || 'lineupDate', targetStageKey: stages[0]?.key || '' });
  }
  const pickTrigger = (value) => { const [trigger, key] = value.split(':'); setEdit({ ...edit, trigger, triggerKey: key }); };
  const draftName = edit ? `${triggers.find((t) => t.trigger === edit.trigger && t.key === edit.triggerKey)?.label || ''} → ${stageName(edit.targetStageKey)}` : '';
  const duplicate = edit && taken.has(slot(edit));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Move candidates forward automatically when HR sets a date or marks a mail as sent. They only ever move forward — never back, and never if they are on hold, rejected or joined.</p>
        <Button size="sm" onClick={openNew} disabled={!options.data}><Plus /> New rule</Button>
      </div>
      <ErrorNote onRetry={rules.reload}>{rules.error}</ErrorNote>
      <ErrorNote>{error}</ErrorNote>
      {rules.loading && !rules.data && <Loading />}

      {rules.data && list.length === 0 && starters.length === 0 && <EmptyState title="No rules yet" body="Create one, for example: when an interview date is set, move the candidate to Interview." />}

      {starters.length > 0 && (
        <Notice tone="info" title="Suggested rules">
          <div className="mt-2 flex flex-wrap gap-2">
            {starters.map((s) => <Button key={slot(s)} size="sm" variant="outline" disabled={busy} onClick={() => create(s)}><Zap /> {s.name}</Button>)}
          </div>
        </Notice>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {list.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-sm text-muted-foreground">When {triggerLabel(r).toLowerCase()}, move to <b>{stageName(r.targetStageKey)}</b></p>
              </div>
              <Badge variant={r.isEnabled ? 'secondary' : 'outline'}>{r.isEnabled ? 'On' : 'Off'}</Badge>
            </div>
            <div className="mt-auto flex gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => toggle(r)}>{r.isEnabled ? 'Turn off' : 'Turn on'}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(r)}><Trash2 /> Delete</Button>
            </div>
          </div>
        ))}
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title="New rule" description="One rule per trigger.">
        {edit && (
          <div className="flex flex-col gap-4">
            <ErrorNote>{error}</ErrorNote>
            <Field label="When" htmlFor="ar-trigger">
              <NativeSelect id="ar-trigger" value={`${edit.trigger}:${edit.triggerKey}`} onChange={(e) => pickTrigger(e.target.value)}>
                {triggers.map((t) => <option key={`${t.trigger}:${t.key}`} value={`${t.trigger}:${t.key}`}>{t.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Move the candidate to" htmlFor="ar-stage">
              <NativeSelect id="ar-stage" value={edit.targetStageKey} onChange={(e) => setEdit({ ...edit, targetStageKey: e.target.value })}>
                {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Name" htmlFor="ar-name"><Input id="ar-name" value={edit.name ?? draftName} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {duplicate && <Notice tone="warn">There is already a rule for that trigger. Turn it off or delete it first.</Notice>}
            <Button size="lg" disabled={busy || duplicate || !edit.targetStageKey} onClick={() => create({ name: (edit.name ?? draftName).trim(), trigger: edit.trigger, triggerKey: edit.triggerKey, targetStageKey: edit.targetStageKey })}>{busy ? 'Saving…' : 'Save rule'}</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
