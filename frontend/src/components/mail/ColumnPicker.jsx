import { ArrowUp, ArrowDown, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Choose and order the columns of a tracker table.
 * `value`  [{ key, label? }] in display order · `catalogue` [{ key, label, group }]
 * Used by the manager's template editor and by HR's per-send toggles.
 */
export function ColumnPicker({ catalogue, value, onChange, allowRename = false }) {
  const byKey = new Map(catalogue.map((c) => [c.key, c]));
  const chosen = new Set(value.map((c) => c.key));
  const groups = [...new Set(catalogue.map((c) => c.group))];

  const move = (i, d) => {
    const next = [...value];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (key) => onChange(value.filter((c) => c.key !== key));
  const add = (key) => onChange([...value, { key }]);
  const rename = (key, label) => onChange(value.map((c) => (c.key === key ? { ...c, label: label || undefined } : c)));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-medium">In the table ({value.length})</p>
        {value.length === 0 && <p className="text-sm text-muted-foreground">Pick at least one column below.</p>}
        <ol className="flex flex-col gap-1.5">
          {value.map((c, i) => (
            <li key={c.key} className="flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5">
              <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
              {allowRename ? (
                <input aria-label={`Heading for ${byKey.get(c.key)?.label || c.key}`} className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                  placeholder={byKey.get(c.key)?.label || c.key} value={c.label || ''} maxLength={40} onChange={(e) => rename(c.key, e.target.value)} />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">{c.label || byKey.get(c.key)?.label || c.key}</span>
              )}
              <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove column" disabled={value.length === 1} onClick={() => remove(c.key)}><X /></Button>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((g) => {
          const left = catalogue.filter((c) => c.group === g && !chosen.has(c.key));
          if (left.length === 0) return null;
          return (
            <div key={g}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g}</p>
              <div className="flex flex-wrap gap-2">
                {left.map((c) => (
                  <button key={c.key} type="button" onClick={() => add(c.key)}
                    className={cn('flex h-9 items-center gap-1 rounded-full border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-accent')}>
                    <Plus className="size-3.5" /> {c.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
