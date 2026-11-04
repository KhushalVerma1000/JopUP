import { Link } from 'react-router-dom';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Bar, ErrorNote, Notice, Section, StatTile } from '@/components/common';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/dataImport';

function Next({ to, onClick, children }) {
  const cls = 'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
  return <li>{to ? <Link to={to} className={cls}>{children}<ChevronRight className="size-4 text-muted-foreground" aria-hidden /></Link>
    : <button type="button" onClick={onClick} className={cls}>{children}<ChevronRight className="size-4 text-muted-foreground" aria-hidden /></button>}</li>;
}

export function ImportStep({ batch, progress, undone, onUndo, undoing, onAgain, skippedCount, onDownload, error }) {
  const running = batch.status === 'importing' || batch.status === 'previewed';
  if (running) {
    const p = progress || batch.progress || { total: 0, processed: 0 };
    return (
      <div className="rounded-xl border bg-card p-4" role="status" aria-live="polite">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Loader2 className="size-4 animate-spin" aria-hidden />Importing {plural((batch.files || []).filter((f) => f.status === 'read').length || 1, 'file')}</p>
        <Bar value={p.processed} max={p.total} label="Import progress" />
        <p className="mt-2 text-sm text-muted-foreground tabular-nums">{p.processed} of {p.total} rows</p>
        <p className="mt-1 text-xs text-muted-foreground">Keep this page open until it finishes. Rows already written stay in, and nothing is written twice.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    );
  }

  if (undone) {
    const u = (undone.undo || {}); const r = u.removed || {}; const k = u.kept || {};
    const keptTotal = Object.values(k).reduce((a, b) => a + b, 0);
    return (
      <div>
        <Notice tone="good" title="Import undone">
          Removed {plural(r.candidates || 0, 'candidate')}, {plural(r.trackers || 0, 'tracker')} and {plural(r.clients || 0, 'client')}.
          {keptTotal > 0 && ` ${keptTotal} item${keptTotal === 1 ? ' was' : 's were'} kept because ${keptTotal === 1 ? 'it was' : 'they were'} changed or used after the import.`}
        </Notice>
        <div className="mt-4"><Button type="button" variant="outline" onClick={onAgain}>Import more files</Button></div>
      </div>
    );
  }

  const res = batch.result || { rows: {} };
  const failed = (res.rows || {}).failed || 0;
  return (
    <div>
      {failed > 0 && <Notice tone="warn" title={`${plural(failed, 'row')} could not be imported`} className="mb-4">The rest went in. Download the list of left-out rows to see which ones to fix.</Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Candidates" value={res.candidatesCreated || 0} sub={res.candidatesReused ? `added · ${res.candidatesReused} already here` : 'added'} />
        <StatTile label="Trackers" value={res.trackersCreated || 0} sub="created" />
        <StatTile label="Clients" value={res.clientsCreated || 0} sub="added" />
        <StatTile label="Left out" value={skippedCount} sub={skippedCount ? 'download below' : 'none'} />
      </div>
      <Section title="Next" className="mt-5">
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          <Next to="/hr">Open the HR workbench</Next>
          {(res.clientsCreated || 0) > 0 && <Next to="/clients">Add contacts for {plural(res.clientsCreated, 'new client')}</Next>}
          {skippedCount > 0 && <Next onClick={onDownload}>Download left-out rows ({skippedCount})</Next>}
        </ul>
      </Section>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">One undo covers every file in this import, for 14 days.</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onAgain}>Import more files</Button>
          <Button type="button" variant="outline" disabled={undoing} onClick={onUndo}>{undoing ? 'Undoing…' : 'Undo import'}</Button>
        </div>
      </div>
    </div>
  );
}
