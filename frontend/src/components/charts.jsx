import { cn } from '@/lib/utils';

/** Tiny trend line. Decorative — the numbers beside it carry the meaning. */
export function Sparkline({ values, tone = 'default', className }) {
  if (!values || values.length < 2) return <div className={cn('h-8 w-24 rounded bg-muted/60', className)} aria-hidden />;
  const w = 96; const h = 32; const pad = 3;
  const min = Math.min(...values); const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)]);
  const stroke = tone === 'good' ? 'stroke-emerald-600' : tone === 'bad' ? 'stroke-destructive' : tone === 'warn' ? 'stroke-amber-500' : 'stroke-primary';
  const fill = tone === 'good' ? 'fill-emerald-600' : tone === 'bad' ? 'fill-destructive' : tone === 'warn' ? 'fill-amber-500' : 'fill-primary';
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-8 w-24 shrink-0', className)} aria-hidden>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={stroke} />
      <circle cx={lx} cy={ly} r="2.5" className={fill} />
    </svg>
  );
}

/** Horizontal funnel row: label, bar, count and (optional) conversion from the previous row. */
export function FunnelRow({ label, count, max, conversion }) {
  const pct = max > 0 ? Math.max(count > 0 ? 3 : 0, Math.round((count / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm md:grid-cols-[7rem_1fr_auto]">
      <span className="truncate text-muted-foreground">{label}</span>
      <div className="h-6 overflow-hidden rounded-md bg-muted" role="img" aria-label={`${label}: ${count}`}>
        <div className="h-full rounded-md bg-primary/80" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right tabular-nums">
        <span className="font-semibold">{count}</span>
        {conversion !== undefined && <span className="ml-1 text-xs text-muted-foreground">{conversion}%</span>}
      </span>
    </div>
  );
}
