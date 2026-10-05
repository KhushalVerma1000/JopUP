import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Sheet, Loading, ErrorNote } from '@/components/common';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useFetch } from '../../hooks/useFetch';
import { fullName } from '../../lib/format';
import { cn } from '@/lib/utils';

/**
 * Multi-select candidates from the org's database to tag onto a position.
 * `excludeIds` are candidates already live on that position (shown greyed
 * out and not selectable) so the same person can't be tagged twice.
 * `footer` renders between the list and the confirm button (result notices).
 */
export function CandidatePicker({ open, onClose, title, excludeIds = [], busy, error, footer, onConfirm }) {
  const { data, loading, error: loadError, reload } = useFetch(open ? '/api/v1/candidates' : null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  useEffect(() => { if (open) { setQ(''); setPicked([]); } }, [open]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data?.candidates || [];
    if (!needle) return all;
    return all.filter((c) => [fullName(c), c.phone, c.location].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [data, q]);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or city…" className="pl-9" aria-label="Search candidates" autoFocus />
      </div>
      <ErrorNote onRetry={reload}>{loadError}</ErrorNote>
      {loading && !data && <Loading />}
      <ul className="mb-4 flex max-h-[50svh] flex-col gap-2 overflow-y-auto">
        {list.map((c) => {
          const already = excludeIds.includes(c.id);
          const on = picked.includes(c.id);
          return (
            <li key={c.id}>
              <button type="button" role="checkbox" aria-checked={on} disabled={already} onClick={() => toggle(c.id)} className={cn('flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent/60 disabled:opacity-50', on && 'border-primary bg-accent/50')}>
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded border', on && 'border-primary bg-primary text-primary-foreground')}>{on && <Check className="size-3.5" aria-hidden />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{fullName(c)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[c.phone, c.location].filter(Boolean).join(' · ') || '—'}</span>
                </span>
                {already && <span className="shrink-0 text-xs text-muted-foreground">Already tagged</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {data && list.length === 0 && <p className="mb-4 text-center text-sm text-muted-foreground">No candidates match that search.</p>}
      <ErrorNote>{error}</ErrorNote>
      {footer}
      <Button size="lg" className="w-full" disabled={picked.length === 0 || busy} onClick={() => onConfirm(picked)}>
        {busy ? 'Tagging…' : picked.length ? `Tag ${picked.length} candidate${picked.length === 1 ? '' : 's'}` : 'Select candidates to tag'}
      </Button>
    </Sheet>
  );
}
