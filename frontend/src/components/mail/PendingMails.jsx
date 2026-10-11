import { useState } from 'react';
import { Check } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch';
import { cn } from '@/lib/utils';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function dayName(date) {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (date === iso(now)) return 'Today';
  if (date === iso(tomorrow)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function Status({ p }) {
  if (p.sent) return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check className="size-3.5" aria-hidden /> Sent</span>;
  if (p.partlySent) return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">{p.unsent} new since sent</span>;
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Not sent</span>;
}

/**
 * "Needs sending": every day-based mail due in the next two weeks, with whether it has gone out.
 * One tap opens that exact mail in the picker below, so the day starts from this list instead of
 * from remembering which client and location to check.
 */
export function PendingMails({ value, onPick, refreshKey }) {
  const { data, loading } = useFetch(`/api/v1/mail/pending?r=${refreshKey ? 1 : 0}`);
  const [all, setAll] = useState(false);
  if (loading || !data || data.length === 0) return null;
  const todo = data.filter((p) => !p.sent).length;
  const shown = all ? data : data.slice(0, 6);

  return (
    <section className="mb-5 rounded-xl border bg-card p-4 md:p-5" aria-label="Needs sending">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <b className="text-[13px] font-semibold">Needs sending</b>
        <span className="text-xs text-muted-foreground">{todo === 0 ? 'All sent' : `${todo} to send`}</span>
      </div>
      <ul className="divide-y">
        {shown.map((p, i) => {
          const active = value.type === p.type && value.client === p.clientId && value.loc === p.locationId && value.date === p.date;
          return (
            <li key={`${p.type}|${p.clientId}|${p.locationId}|${p.date}`}>
              {(i === 0 || shown[i - 1].date !== p.date) && <div className="pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">{dayName(p.date)}</div>}
              <button type="button" onClick={() => onPick({ type: p.type, client: p.clientId, loc: p.locationId, date: p.date })}
                className={cn('flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent', active && 'bg-primary/5 ring-1 ring-primary', p.sent && 'opacity-70')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.clientName} · {p.locationName}</span>
                  <span className="block text-xs text-muted-foreground">{p.typeLabel} · {p.count} {p.count === 1 ? 'candidate' : 'candidates'}</span>
                </span>
                <Status p={p} />
              </button>
            </li>
          );
        })}
      </ul>
      {data.length > 6 && <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 py-2 text-[13px] font-medium text-primary hover:underline">{all ? 'Show fewer' : `Show all ${data.length}`}</button>}
    </section>
  );
}
