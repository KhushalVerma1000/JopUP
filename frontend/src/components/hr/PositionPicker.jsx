import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Sheet } from '@/components/common';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Pick one open position from a searchable list. Replaces the bare <select>
 * so HR can find "the Pune sales position for Lumen" by typing any of
 * designation / client / location, and sees how full each one already is.
 *
 * `positions` should already be limited to what's valid for the caller
 * (right team, status open). `onSelect(null)` is called for the clear row.
 */
export function PositionPicker({ open, onClose, positions, selectedId, onSelect, title = 'Tag to position', allowClear = false, clearLabel = 'No position' }) {
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...positions].sort((a, b) => (a.clientName || '~').localeCompare(b.clientName || '~') || a.designation.localeCompare(b.designation));
    if (!needle) return sorted;
    return sorted.filter((p) => [p.designation, p.clientName, p.location].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [positions, q]);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search position, client or city…" className="pl-9" aria-label="Search positions" autoFocus />
      </div>
      <ul className="flex flex-col gap-2">
        {allowClear && (
          <li>
            <button type="button" aria-pressed={!selectedId} onClick={() => onSelect(null)} className={cn('flex min-h-12 w-full items-center justify-between rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 active:bg-accent', !selectedId && 'border-primary')}>
              {clearLabel}{!selectedId && <Check className="size-4 text-primary" aria-hidden />}
            </button>
          </li>
        )}
        {list.map((p) => {
          const selected = p.id === selectedId;
          return (
            <li key={p.id}>
              <button type="button" aria-pressed={selected} onClick={() => onSelect(p.id)} className={cn('flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent/60 active:bg-accent', selected && 'border-primary bg-accent/50')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.designation}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[p.clientName || 'Internal', p.location].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {p.filledCount}/{p.vacancies} filled<br />{p.activeCount} in pipeline
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {positions.length === 0 ? 'No open positions yet. Create one in the Positions tab, then tag candidates to it.' : 'No position matches that search.'}
        </p>
      )}
    </Sheet>
  );
}
