import { useState } from 'react';
import { Plus, Trash2, Pencil, Star } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { Sheet, ErrorNote, Field, Notice, Loading, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { ColumnPicker } from '../mail/ColumnPicker';

const TYPES = [
  ['interview_tracker', 'Interview tracker'], ['submission_tracker', 'Submission tracker'], ['offer_tracker', 'Offer tracker'],
  ['joining_tracker', 'Joining tracker'], ['status_tracker', 'Status tracker'], ['custom', 'Other'],
];
const BLANK = { name: '', teamId: '', trackerType: 'interview_tracker', columns: [{ key: 'candidate_name' }, { key: 'mobile' }, { key: 'position' }, { key: 'location' }, { key: 'lineup_time' }], isDefault: false };

/** Managers define which columns a client tracker mail shows. HR only picks one. */
export function TemplatesTab() {
  const { isOrgAdmin } = useAuth();
  const templates = useFetch('/api/v1/mail/templates');
  const catalogue = useFetch('/api/v1/mail/columns');
  const teams = useFetch('/api/v1/teams');
  const teamList = teams.data?.teams || [];
  const [edit, setEdit] = useState(null);     // null | { id?, ...fields }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const teamName = (id) => (id ? teamList.find((t) => t.id === id)?.name || 'Team' : 'Whole organisation');

  async function save() {
    setBusy(true); setError(null);
    try {
      const body = { name: edit.name, trackerType: edit.trackerType, columns: edit.columns, isDefault: edit.isDefault };
      if (edit.id) await apiFetch(`/api/v1/mail/templates/${edit.id}`, { method: 'PATCH', body });
      else await apiFetch('/api/v1/mail/templates', { method: 'POST', body: { ...body, teamId: edit.teamId || null } });
      setEdit(null);
      await templates.reload();
    } catch (err) { setError(errorMessage(err, 'Could not save the template.')); } finally { setBusy(false); }
  }
  async function remove(t) {
    if (!window.confirm(`Delete "${t.name}"? Trackers HR copies later will no longer offer it.`)) return;
    setError(null);
    try { await apiFetch(`/api/v1/mail/templates/${t.id}`, { method: 'DELETE' }); await templates.reload(); }
    catch (err) { setError(errorMessage(err, 'Could not delete the template.')); }
  }

  const list = templates.data || [];
  const needsTeam = !edit?.id && !isOrgAdmin && !edit?.teamId;
  const valid = edit && edit.name.trim() && edit.columns.length > 0 && !needsTeam;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Choose the columns a tracker email to a client shows. HR picks a template when they send and can hide or add columns for that one mail.</p>
        <Button size="sm" onClick={() => { setError(null); setEdit({ ...BLANK, teamId: isOrgAdmin ? '' : teamList[0]?.id || '' }); }}><Plus /> New template</Button>
      </div>
      <ErrorNote onRetry={templates.reload}>{templates.error}</ErrorNote>
      <ErrorNote>{error}</ErrorNote>
      {templates.loading && !templates.data && <Loading />}
      {templates.data && list.length === 0 && <EmptyState title="No templates yet" body="Create one, for example an Interview tracker with Name, Mobile, Position, Location and Interview time." />}

      <div className="grid gap-3 md:grid-cols-2">
        {list.map((t) => (
          <div key={t.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">{teamName(t.teamId)} · {t.columns.length} columns</p>
              </div>
              {t.isDefault && <Badge variant="secondary"><Star className="size-3" /> Default</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{t.columns.map((c) => c.label || (catalogue.data || []).find((x) => x.key === c.key)?.label || c.key).join(' · ')}</p>
            <div className="mt-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setError(null); setEdit({ ...t, teamId: t.teamId || '' }); }}><Pencil /> Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => remove(t)}><Trash2 /> Delete</Button>
            </div>
          </div>
        ))}
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit?.id ? 'Edit template' : 'New template'} description="The order here is the order of the columns in the email.">
        {edit && (
          <div className="flex flex-col gap-4">
            <ErrorNote>{error}</ErrorNote>
            <Field label="Name" htmlFor="tt-name"><Input id="tt-name" value={edit.name} maxLength={80} placeholder="Interview tracker" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Type" htmlFor="tt-type">
              <NativeSelect id="tt-type" value={edit.trackerType} onChange={(e) => setEdit({ ...edit, trackerType: e.target.value })}>
                {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </NativeSelect>
            </Field>
            {!edit.id && (
              <Field label="Available to" htmlFor="tt-team" hint="Can't be changed later.">
                <NativeSelect id="tt-team" value={edit.teamId} onChange={(e) => setEdit({ ...edit, teamId: e.target.value })}>
                  {isOrgAdmin && <option value="">Whole organisation</option>}
                  {teamList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={edit.isDefault} onChange={(e) => setEdit({ ...edit, isDefault: e.target.checked })} />
              Preselect this for HR when they email a tracker
            </label>
            {catalogue.data
              ? <ColumnPicker allowRename catalogue={catalogue.data} value={edit.columns} onChange={(columns) => setEdit({ ...edit, columns })} />
              : <Loading />}
            {needsTeam && <Notice tone="warn">Pick a team for this template.</Notice>}
            <Button size="lg" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : 'Save template'}</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
