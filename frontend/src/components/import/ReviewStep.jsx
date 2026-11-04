import { Loader2 } from 'lucide-react';
import { ErrorNote, Notice, Section, StatTile } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { plural } from '@/lib/dataImport';

const reasonOf = (r) => {
  const issue = (r.issues || []).find((i) => i.level === 'error') || (r.issues || []).find((i) => i.level === 'warn');
  if (issue) return { text: issue.message, bad: issue.level === 'error' };
  return { text: r.plan && r.plan.action === 'blocked' ? 'Cannot be imported' : 'Left out', bad: r.plan && r.plan.action === 'blocked' };
};
const personOf = (r) => `${(r.data.candidate || {}).firstName || ''} ${(r.data.candidate || {}).lastName || ''}`.trim() || 'No name';

function Ask({ title, sub, value, onChange, children }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-48 text-sm">
        <p className="font-medium">{title}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <NativeSelect aria-label={title} className="sm:w-64" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {children}
      </NativeSelect>
    </li>
  );
}

export function ReviewStep({ batch, skipped, choices, onChoose, alreadyMailed, onMailed, skipBlocked, onSkipBlocked, onBack, onImport, busy, error }) {
  const s = batch.summary; const ent = batch.entities;
  const files = (batch.files || []).filter((f) => f.status === 'read');
  const multi = files.length > 1;
  const clientAsks = ent.clients.filter((e) => e.needsReview || choices.clients[e.key]);
  const posAsks = ent.positions.filter((e) => e.needsReview || choices.positions[e.key]);
  const open = ent.clients.filter((e) => e.needsReview).length + ent.positions.filter((e) => e.needsReview).length;
  const lim = batch.limits || {};
  const overLimit = Object.values(lim).filter((l) => l && l.ok === false);
  const blocked = s.rows.blocked;
  const mustConfirmBlocked = blocked > 0 && !skipBlocked;
  const toImport = s.rows.import;
  const unmatchedRecruiters = ent.recruiters.filter((r) => !r.decision.userId);
  const earlier = (batch.files || []).filter((f) => f.previouslyImported);
  const skipFor = (f) => (skipped.complete && f.label ? skipped.rows.filter((r) => r.sheetName.startsWith(`${f.label} › `)).length : null);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Rows" value={s.rows.total} sub={`${toImport} to import`} />
        <StatTile label="People" value={s.candidates.unique} sub={`${s.candidates.new} new · ${s.candidates.existing} already here`} />
        <StatTile label="Clients" value={ent.clients.length} sub={`${s.clients.new} new`} />
        <StatTile label="Left out" value={s.rows.skip + s.rows.blocked} sub={blocked ? `${blocked} cannot be imported` : 'see below'} tone={blocked ? 'warn' : 'default'} />
      </div>

      {earlier.length > 0 && (
        <Notice tone="warn" title="Some of these files were imported before" className="mt-4">
          {earlier.map((f) => `${f.name} on ${new Date(f.previouslyImported.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`).join('; ')}. People already in the database are matched, not added twice.
        </Notice>
      )}
      {overLimit.length > 0 && (
        <Notice tone="bad" title="This import is over your plan's limit" className="mt-4">
          {overLimit.map((l) => `${l.label}: adding ${l.adding}, ${l.remaining} left`).join('. ')}. Remove a file or leave rows out to continue.
        </Notice>
      )}

      {multi && (
        <Section title="By file" className="mt-5">
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">File</th><th className="px-3 py-2 font-medium">Rows</th>{skipped.complete && <th className="px-3 py-2 font-medium">Left out</th>}</tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.hash} className="border-b last:border-0">
                    <td className="px-3 py-2">{f.name}</td><td className="px-3 py-2 tabular-nums">{f.rows}</td>
                    {skipped.complete && <td className="px-3 py-2 tabular-nums">{skipFor(f)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(batch.files || []).some((f) => f.status === 'duplicate') && <p className="mt-1.5 text-xs text-muted-foreground">Repeated files are counted once.</p>}
        </Section>
      )}

      {(clientAsks.length > 0 || posAsks.length > 0) && (
        <Section title="Needs your answer" hint="A wrong match would put people under the wrong client." className="mt-5">
          <ul className="divide-y rounded-xl border bg-card px-4">
            {clientAsks.map((e) => (
              <Ask key={`c-${e.key}`} title={`Client “${e.label}”`} sub={e.match && e.match.label ? `Looks like “${e.match.label}” · ${plural(e.rows, 'row')}` : `Close to more than one client · ${plural(e.rows, 'row')}`}
                value={choices.clients[e.key]} onChange={(v) => onChoose('clients', e.key, v, e)}>
                <option value="create">Create “{e.label}” as a new client</option>
                {e.match && e.match.id && <option value={`use:${e.match.id}`}>Use {e.match.label}</option>}
              </Ask>
            ))}
            {posAsks.map((e) => (
              <Ask key={`p-${e.key}`} title={`Position “${e.designation}”${e.location ? ` in ${e.location}` : ''}`} sub={`${plural(e.rows, 'row')}`} value={choices.positions[e.key]} onChange={(v) => onChoose('positions', e.key, v, e)}>
                <option value="create">Create a new position</option>
                <option value="none">Don’t link a position</option>
                {e.match && e.match.id && <option value={`use:${e.match.id}`}>Use {e.match.label || 'the similar position'}</option>}
                {(e.options || []).map((o) => <option key={o.id} value={`use:${o.id}`}>Use {o.label}</option>)}
              </Ask>
            ))}
          </ul>
        </Section>
      )}

      {unmatchedRecruiters.length > 0 && (
        <Notice className="mt-4" title="Recruiter names are not assigned">
          {unmatchedRecruiters.map((r) => `“${r.label}” (${plural(r.rows, 'row')})`).join(', ')} could not be matched to a person. Imported trackers are created under your name; recruiter columns are not assigned yet.
        </Notice>
      )}

      {skipped.rows.length > 0 && (
        <Section title={`Left out (${skipped.total})`} className="mt-5" action={<Button type="button" variant="outline" size="sm" onClick={skipped.onDownload}>Download list</Button>}>
          <ul className="divide-y rounded-xl border bg-card px-4 text-sm">
            {skipped.rows.slice(0, 8).map((r) => { const why = reasonOf(r); return (
              <li key={`${r.sheetName}-${r.rowNumber}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 flex-1 basis-48 truncate">{personOf(r)} <span className="text-xs text-muted-foreground">· {r.sheetName}, row {r.rowNumber}</span></span>
                <Badge variant={why.bad ? 'destructive' : 'outline'} className="max-w-full truncate">{why.text}</Badge>
              </li>); })}
            {skipped.total > 8 && <li className="py-2 text-xs text-muted-foreground">{skipped.total - 8} more. Download the list to see them all.</li>}
          </ul>
        </Section>
      )}

      <div className="mt-5 space-y-2 text-sm">
        {blocked > 0 && (
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-4" checked={skipBlocked} onChange={(e) => onSkipBlocked(e.target.checked)} />
            <span>Leave out the {plural(blocked, 'row')} that cannot be imported and import the rest</span></label>
        )}
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-4" checked={alreadyMailed} onChange={(e) => onMailed(e.target.checked)} />
          <span>Today’s and later lineups were already mailed to clients <span className="text-muted-foreground">(so they are not listed as “needs sending”)</span></span></label>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>Back</Button>
        <div className="flex items-center gap-3">
          {open > 0 && <span className="text-xs text-muted-foreground" aria-live="polite">{plural(open, 'answer')} needed</span>}
          <Button type="button" onClick={onImport} disabled={busy || open > 0 || mustConfirmBlocked || overLimit.length > 0 || toImport === 0}>
            {busy ? <><Loader2 className="animate-spin" aria-hidden />Starting…</> : `Import ${plural(toImport, 'row')}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
