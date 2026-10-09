import { forwardRef, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3 md:mb-6">
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
    <div className="rounded-xl border border-dashed bg-card/50 px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  if (!children) return null;
  return (
    <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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

// Open sheets, topmost last. Lets nested sheets (a picker opened from a form)
// behave: only the top one answers Escape / Tab, and the page's scroll lock is
// taken once and released once, whatever order they close in.
const openSheets = [];
let savedBodyOverflow = '';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on phones, centred dialog on md+.
 * Keyboard: Esc closes (top sheet only), Tab is trapped inside, and focus goes
 * back to whatever opened it. Focus lands on the first `autoFocus` field if
 * there is one, otherwise on the dialog itself.
 */
const SHEET_WIDTH = { md: 'md:max-w-md', lg: 'md:max-w-2xl', xl: 'md:max-w-5xl' };

export function Sheet({ open, onClose, title, description, size = 'md', children }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const uid = useId();

  // Remember what had focus at the moment the sheet opens. This has to happen
  // during render: by the time an effect runs, an `autoFocus` field inside the
  // sheet has already taken focus, and we'd "restore" focus to that field.
  const openerRef = useRef(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) openerRef.current = document.activeElement;
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return undefined;
    const opener = openerRef.current;
    if (openSheets.length === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openSheets.push(uid);

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();

    const onKey = (e) => {
      if (openSheets[openSheets.length - 1] !== uid) return;
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const i = openSheets.indexOf(uid);
      if (i >= 0) openSheets.splice(i, 1);
      if (openSheets.length === 0) document.body.style.overflow = savedBodyOverflow;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [open, uid]);

  if (!open) return null;
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn('relative flex max-h-[92svh] w-full flex-col rounded-t-2xl border bg-background shadow-xl outline-none md:max-h-[88svh] md:rounded-xl', SHEET_WIDTH[size] || SHEET_WIDTH.md)}
      >
        {/* Grab bar: tells a phone user this is a sheet they can dismiss. */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30 md:hidden" aria-hidden />
        {/* Title stays put while a long form scrolls underneath. */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-3 md:pt-5">
          <h2 id={titleId} className="min-w-0 text-lg font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button>
        </div>
        <div className="pb-safe min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          {description && <p id={descId} className="mb-4 text-sm text-muted-foreground">{description}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Label + control + optional hint, so every form field is spaced and wired the same way. */
export function Field({ label, htmlFor, hint, className, children }) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const NOTICE_TONES = { info: 'bg-muted', good: TONES.good, warn: TONES.warn, bad: TONES.bad };

/**
 * Inline message. One component for what used to be hand-rolled amber and
 * emerald banners: `warn`/`bad` are announced immediately (role=alert),
 * `info`/`good` politely (role=status). Put buttons in `actions`.
 */
export function Notice({ tone = 'info', title, children, actions, className }) {
  const urgent = tone === 'warn' || tone === 'bad';
  return (
    <div role={urgent ? 'alert' : 'status'} className={cn('rounded-lg border px-3 py-2.5 text-sm', NOTICE_TONES[tone], className)}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && 'mt-1', 'text-muted-foreground')}>{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** The one floating primary action a screen may have (sits above the mobile tab bar). */
export function Fab({ icon: Icon, children, className, ...props }) {
  return (
    <button
      type="button"
      className={cn('pb-safe fixed bottom-20 right-4 z-20 flex h-14 items-center gap-2 rounded-full bg-primary px-5 font-medium text-primary-foreground shadow-lg active:scale-95 md:bottom-8 md:right-8', className)}
      {...props}
    >
      {Icon && <Icon className="size-5" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * 44px round icon action (call, copy, mail…). Renders a link when given
 * `href`, otherwise a button. Always pass `aria-label` — there is no text.
 */
export const RoundAction = forwardRef(function RoundAction({ tone = 'muted', className, children, ...props }, ref) {
  const cls = cn('flex size-11 shrink-0 items-center justify-center rounded-full border active:scale-95 md:size-9 md:transition-colors', tone === 'accent' ? 'border-transparent bg-accent text-accent-foreground md:hover:bg-accent/70' : 'bg-card text-foreground md:hover:bg-accent', className);
  return props.href
    ? <a ref={ref} className={cls} {...props}>{children}</a>
    : <button ref={ref} type="button" className={cls} {...props}>{children}</button>;
});

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
export function Bar({ value, max, className, tone = 'primary', label }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full border bg-muted', className)} role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={cn('h-full rounded-full', tone === 'warn' ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  );
}
