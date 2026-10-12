import { useEffect } from 'react';
import { Chips, Loading, ErrorNote } from '@/components/common';
import { cn } from '@/lib/utils';
import { useFetch } from '../../hooks/useFetch';

const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };

const STEP_TITLE = { client: 'Client', location: 'Hiring location', date: 'Date' };

/** One step of the picker: a numbered heading, then the choices. */
function Step({ n, title, hint, children }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{n}</span>
        <b className="text-[13px] font-semibold">{title}</b>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * "What are you sending?" then Client → Hiring location → Date.
 * Each step only offers what exists for the step before it, so there is nothing to
 * mistype and no way to pick a combination that has no candidates. When a step has
 * one sensible answer it is chosen for you (the nearest day, a lone client).
 *
 * Fully controlled by `value` ({ type, client, loc, date }); `onChange` gets the
 * next value with every later step cleared, so a stale choice can never survive.
 * Reports the resolved candidate ids (and the chosen mail kind) through `onReady`.
 */
export function MailPicker({ value, onChange, onReady }) {
  const types = useFetch('/api/v1/mail/types');
  const kind = types.data?.find((t) => t.key === value.type) || null;
  const qs = new URLSearchParams({ type: value.type || '', ...(value.client ? { clientId: value.client } : {}), ...(value.loc ? { locationId: value.loc } : {}), ...(value.date ? { date: value.date } : {}) });
  const opts = useFetch(kind ? `/api/v1/mail/options?${qs}` : null);
  const o = opts.data;
  const needsDate = !!kind?.needs.includes('date');

  const set = (patch) => onChange({ ...value, ...patch });
  const pickType = (type) => onChange({ type, client: '', loc: '', date: '' });
  const pickClient = (client) => onChange({ ...value, client, loc: '', date: '' });
  const pickLoc = (loc) => onChange({ ...value, loc, date: '' });

  // Choose for the person when there is only one answer.
  useEffect(() => {
    if (!o || o.type !== value.type) return;
    if (!value.client && o.clients.length === 1) set({ client: o.clients[0].id });
    else if (value.client && !value.loc) {
      const real = o.locations.filter((l) => l.id !== 'all');
      if (real.length === 1) set({ loc: real[0].id });
    } else if (needsDate && value.loc && !value.date && o.dates.length) {
      const today = todayIso();
      set({ date: (o.dates.find((d) => d.date >= today) || o.dates[o.dates.length - 1]).date });
    }
  }, [o]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const complete = !!(o && o.type === value.type && value.client && value.loc && (!needsDate || value.date));
    onReady(complete ? { kind, trackerIds: o.trackerIds } : null);
  }, [o, value.client, value.loc, value.date, value.type]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mb-5 space-y-5 rounded-xl border bg-card p-4 md:p-5">
      <div>
        <b className="mb-2 block text-[13px] font-semibold">What are you sending?</b>
        {types.loading && <Loading />}
        <ErrorNote>{types.error}</ErrorNote>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {(types.data || []).map((t) => (
            <button key={t.key} type="button" aria-pressed={t.key === value.type} onClick={() => pickType(t.key)}
              className={cn('rounded-lg border p-3 text-left transition-colors', t.key === value.type ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-background hover:bg-accent')}>
              <div className="text-sm font-semibold">{t.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t.blurb}</div>
            </button>
          ))}
        </div>
      </div>

      {kind && (
        <>
          <ErrorNote>{opts.error}</ErrorNote>
          {opts.loading && !o && <Loading />}
          {o && o.clients.length === 0 && (
            <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
              {o.undated > 0
                ? `${o.undated} ${o.undated === 1 ? 'candidate has' : 'candidates have'} no ${kind.key === 'lineup' ? 'lineup' : 'interview'} date yet. Set dates in the HR workbench and they will show up here.`
                : `No candidates fit a ${kind.label.toLowerCase()} mail yet. Tag candidates to a client's open position and they will show up here.`}
            </p>
          )}
          {o && o.clients.length > 0 && (
            <Step n={1} title={STEP_TITLE.client}>
              <Chips items={o.clients.map((c) => ({ key: c.id, label: c.name, count: c.count }))} value={value.client} onChange={pickClient} />
            </Step>
          )}
          {o && value.client && (
            <Step n={2} title={STEP_TITLE.location} hint="Where this client is hiring">
              <Chips items={o.locations.map((l) => ({ key: l.id, label: l.name, count: l.count }))} value={value.loc} onChange={pickLoc} />
            </Step>
          )}
          {o && value.loc && needsDate && (
            <Step n={3} title={STEP_TITLE.date} hint={o.undated ? `${o.undated} without a ${kind.key === 'lineup' ? 'lineup' : 'interview'} date are not listed` : null}>
              {o.dates.length === 0
                ? <p className="text-sm text-muted-foreground">No candidates have a date set here. Set one in the HR workbench first.</p>
                : <Chips items={o.dates.map((d) => ({ key: d.date, label: `${d.date === todayIso() ? 'Today · ' : ''}${dayLabel(d.date)}`, count: d.count }))} value={value.date} onChange={(date) => set({ date })} />}
            </Step>
          )}
        </>
      )}
    </div>
  );
}
