import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, hint, action, children, className }) {
  return (
    <section className={cn('mb-6', className)}>
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  default: 'bg-card',
  warn: 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/30',
  good: 'border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30',
  bad: 'border-destructive/40 bg-destructive/5',
};

export function StatTile({ label, value, sub, tone = 'default', icon: Icon }) {
  return (
    <Card className={cn('gap-1 p-4', TONES[tone])}>
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-4" aria-hidden />}
      </div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  if (!children) return null;
  return (
    <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <span>{children}</span>
      {onRetry && <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-4">Retry</button>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{label}</div>;
}

/** Scrollable pill row for filters. items: [{ key, label, count? }] */
export function Chips({ items, value, onChange, className }) {
  return (
    <div className={cn('scroll-x -mx-4 flex gap-2 px-4 pb-1 md:mx-0 md:px-0', className)} role="tablist">
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={cn(
              'flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors md:h-9',
              active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
            )}
          >
            {it.label}
            {it.count !== undefined && (
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-primary-foreground/20' : 'bg-muted')}>{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on md+. Esc / backdrop closes. */
export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="pb-safe relative max-h-[90svh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 shadow-xl md:max-w-md md:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Deterministic pill colours so a status looks the same everywhere. */
const PILL = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  trialing: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  cancelled: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  on_hold: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  placed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  draft: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  closed: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};
export function StatusPill({ status, children }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize', PILL[status] || 'bg-muted text-muted-foreground')}>
      {children || String(status || '').replace(/_/g, ' ')}
    </span>
  );
}

export function Avatar({ name, className }) {
  const letters = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground', className)} aria-hidden>
      {letters}
    </span>
  );
}

/** Simple proportional bar, used for funnels and limits. */
export function Bar({ value, max, className, tone = 'primary' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={cn('h-full rounded-full', tone === 'warn' ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  );
}
