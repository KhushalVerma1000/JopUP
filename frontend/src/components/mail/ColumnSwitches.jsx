import { useState } from 'react';
import { cn } from '@/lib/utils';

function Switch({ on, label, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange}
      className={cn('relative ml-auto h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-primary' : 'bg-[#C5CAD8]')}>
      <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

/**
 * The design's column list: every column with an on/off switch. Switched-on
 * columns come first, in table order, and can be dragged (or moved with the
 * arrow keys on the handle) to reorder; the rest follow, switched off.
 */
export function ColumnSwitches({ catalogue, value, onChange }) {
  const [drag, setDrag] = useState(null);
  const label = (k) => value.find((c) => c.key === k)?.label || catalogue.find((c) => c.key === k)?.label || k;
  const off = catalogue.filter((c) => !value.some((v) => v.key === c.key));

  const toggle = (key) => {
    if (value.some((c) => c.key === key)) { if (value.length > 1) onChange(value.filter((c) => c.key !== key)); } else onChange([...value, { key }]);
  };
  const move = (from, to) => {
    if (from === to || to < 0 || to >= value.length) return;
    const next = [...value]; const [m] = next.splice(from, 1); next.splice(to, 0, m); onChange(next);
  };

  const row = (key, on, i) => (
    <li key={key} draggable={on} onDragStart={() => setDrag(i)} onDragOver={(e) => on && e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
      className="flex min-h-10 items-center gap-2.5 border-t text-sm">
      <span role={on ? 'button' : undefined} tabIndex={on ? 0 : undefined} aria-label={on ? `Move ${label(key)}. Arrow up or down` : undefined}
        onKeyDown={(e) => { if (!on) return; if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); } }}
        className={cn('select-none px-0.5 text-muted-foreground', on && 'cursor-grab')}>⋮⋮</span>
      <span className={cn(!on && 'text-muted-foreground')}>{label(key)}</span>
      <Switch on={on} label={label(key)} onChange={() => toggle(key)} />
    </li>
  );
  return <ul>{value.map((c, i) => row(c.key, true, i))}{off.map((c) => row(c.key, false, -1))}</ul>;
}
