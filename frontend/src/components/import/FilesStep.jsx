import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { ErrorNote, Notice, Section } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import {
  ACCEPT, FIELD_OPTIONS, MAX_FILES, MAX_FILE_BYTES, STATUS_CHOICES, fieldLabel, fileStatus, formatBytes, normHeader, plural, totalsOf, unknownStatuses,
} from '@/lib/dataImport';

const STATE = {
  reading: { label: 'Reading', variant: 'secondary' },
  ready: { label: 'Ready', variant: 'success' },
  check: { label: 'Check', variant: 'outline', className: 'border-amber-400/70 text-amber-700 dark:text-amber-300' },
  skipped: { label: 'Skipped', variant: 'secondary' },
};

function ColumnTable({ sheet, mappingAnswers, onMap }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">In your sheet</th>
            <th className="py-1.5 pr-3 font-medium">Example</th>
            <th className="py-1.5 pr-3 font-medium">Goes to</th>
            <th className="py-1.5 font-medium"><span className="sr-only">Match</span></th>
          </tr>
        </thead>
        <tbody>
          {(sheet.columns || []).map((c) => {
            const key = normHeader(c.label);
            const chosen = mappingAnswers[key];
            return (
              <tr key={c.index} className="border-b last:border-0">
                <td className="py-1.5 pr-3">{c.label}</td>
                <td className="max-w-[10rem] truncate py-1.5 pr-3 text-muted-foreground">{(c.sample || [])[0] || ''}</td>
                <td className="py-1.5 pr-3">
                  <NativeSelect aria-label={`Where "${c.label}" goes`} value={chosen || ''} onChange={(e) => onMap(key, e.target.value)} className="min-w-[10rem]">
                    <option value="">{c.field ? `${fieldLabel(c.field) || c.field} (automatic)` : 'Extra field, kept as is'}</option>
                    {FIELD_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    <option value="ignore">Ignore this column</option>
                  </NativeSelect>
                </td>
                <td className="py-1.5">
                  {c.status === 'review' && !chosen && <Badge variant="outline" className="border-amber-400/70 text-amber-700 dark:text-amber-300">Check</Badge>}
                  {c.status === 'auto' && !chosen && <Badge variant="success">Matched</Badge>}
                  {c.status === 'extra' && !chosen && <Badge variant="secondary">Kept</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FileRow({ entry, open, onToggle, onRemove, mappingAnswers, onMap }) {
  const st = fileStatus(entry.analysis);
  const meta = STATE[st.state];
  const usable = entry.analysis && !entry.analysis.error && !entry.analysis.duplicateOf;
  const sheets = usable ? (entry.analysis.sheets || []).filter((s) => s.kind !== 'unknown') : [];
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-medium">{entry.file.name} <span className="font-normal text-muted-foreground">{formatBytes(entry.file.size)}</span></p>
          <p className="text-xs text-muted-foreground">{st.note}</p>
        </div>
        <Badge variant={meta.variant} className={meta.className}>
          {st.state === 'reading' && <Loader2 className="animate-spin" aria-hidden />}{meta.label}
        </Badge>
        {sheets.length > 0 && (
          <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={onToggle}>
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}Columns
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${entry.file.name}`} onClick={onRemove}><X aria-hidden /></Button>
      </div>
      {open && sheets.length > 0 && (
        <div className="mt-2 space-y-3 rounded-lg border bg-muted/30 p-3">
          {sheets.map((s) => (
            <div key={s.name}>
              {sheets.length > 1 && <p className="mb-1 text-xs font-medium text-muted-foreground">Tab “{s.name}”</p>}
              <ColumnTable sheet={s} mappingAnswers={mappingAnswers} onMap={onMap} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">A change here applies to every file with the same heading.</p>
        </div>
      )}
    </li>
  );
}

export function FilesStep({ entries, rejected, teams, teamId, onTeam, dateOrder, onDateOrder, statusAnswers, onStatus, mappingAnswers, onMap, onAdd, onRemove, onContinue, busy, error }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [openId, setOpenId] = useState(null);
  const totals = totalsOf(entries);
  const unknown = unknownStatuses(entries);
  const reading = entries.some((e) => !e.analysis);
  const canContinue = totals.files > 0 && teamId && !reading && !busy;

  const drop = (e) => { e.preventDefault(); setOver(false); onAdd([...e.dataTransfer.files]); };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={cn('rounded-xl border border-dashed bg-muted/40 px-4 py-6 text-center transition-colors', over && 'border-primary bg-accent')}
      >
        <Upload className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{entries.length ? 'Add more files' : 'Drop your Excel or CSV files here'}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Up to {MAX_FILES} files, {MAX_FILE_BYTES / 1048576} MB each. You can add the same kind of sheet from different months.</p>
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose spreadsheet files" tabIndex={-1}
          onChange={(e) => { onAdd([...e.target.files]); e.target.value = ''; }} />
        <Button type="button" className="mt-3" variant={entries.length ? 'outline' : 'default'} onClick={() => input.current && input.current.click()}>Choose files</Button>
      </div>

      {rejected.length > 0 && (
        <Notice tone="warn" title="Some files were not added" className="mt-3">
          <ul className="list-disc pl-4">{rejected.map((r, i) => <li key={`${r.name}-${i}`}>{r.name}: {r.reason}</li>)}</ul>
        </Notice>
      )}

      {entries.length > 0 && (
        <Section title={`Files (${entries.length})`} className="mt-5">
          <ul className="divide-y rounded-xl border bg-card px-4">
            {entries.map((e) => (
              <FileRow key={e.id} entry={e} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} onRemove={() => onRemove(e.id)}
                mappingAnswers={mappingAnswers} onMap={onMap} />
            ))}
          </ul>
        </Section>
      )}

      {entries.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px] font-medium">Import into team
            <NativeSelect className="mt-1" value={teamId} onChange={(e) => onTeam(e.target.value)}>
              {teams.length === 0 && <option value="">No team available</option>}
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          </label>
          <label className="block text-[13px] font-medium">Dates in the sheets are
            <NativeSelect className="mt-1" value={dateOrder} onChange={(e) => onDateOrder(e.target.value)}>
              <option value="">Work it out (day first if unsure)</option>
              <option value="dmy">Day first (13/10/2026)</option>
              <option value="mdy">Month first (10/13/2026)</option>
            </NativeSelect>
          </label>
        </div>
      )}

      {unknown.length > 0 && (
        <Section title="Status words to confirm" hint="We could not place these. Pick where each one belongs." className="mt-5">
          <ul className="divide-y rounded-xl border bg-card px-4">
            {unknown.map((u) => (
              <li key={u.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <div className="min-w-0 flex-1 basis-40 text-sm">“{u.text}” <span className="text-xs text-muted-foreground">· {plural(u.count, 'row')}{u.files.length > 1 ? ` in ${u.files.length} files` : ''}</span></div>
                <NativeSelect aria-label={`Where “${u.text}” belongs`} className="sm:w-56" value={statusAnswers[u.key] || ''} onChange={(e) => onStatus(u.key, e.target.value)}>
                  <option value="">Stay at current stage</option>
                  {STATUS_CHOICES.filter((c) => c.value !== 'stay').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </NativeSelect>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {reading ? 'Reading files…' : totals.files ? `${plural(totals.files, 'file')} · ${plural(totals.rows, 'row')} · about ${plural(totals.people, 'person', 'people')}` : entries.length ? 'None of these files can be imported.' : ''}
        </p>
        <Button type="button" disabled={!canContinue} onClick={onContinue}>{busy ? <><Loader2 className="animate-spin" aria-hidden />Checking…</> : 'Continue'}</Button>
      </div>
    </div>
  );
}
