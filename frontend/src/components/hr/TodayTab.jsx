import { useEffect, useMemo, useState } from 'react';
import { Phone, MessageCircle, CalendarClock, Check, X, ArrowRight, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { useStagesByTemplate } from '../../hooks/useStagesByTemplate';
import { apiFetch } from '../../lib/api';
import { can } from '../../lib/roles';
import { whatsappUrl, whatsappProps } from '../../lib/whatsapp';
import { dayKey, timeKey, toIso, lineupLabel, todayKey } from '../../lib/lineupDay';
import { buildToday, dayOffset, whatsappText, QUIET_DAYS } from '../../lib/today';
import { nextStepLabel } from '../../lib/stageVerbs';
import { Section, StatTile, EmptyState, ErrorNote, Loading, Notice, Avatar, RoundAction } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';
const PILL_TONE = {
  plain: 'bg-card text-foreground',
  late: 'border-destructive/30 bg-destructive/10 text-destructive',
  warn: 'border-amber-300/60 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  good: 'border-emerald-300/60 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  muted: 'bg-muted text-muted-foreground',
};
const Pill = ({ tone = 'plain', children }) => <span className={`${PILL} ${PILL_TONE[tone]}`}>{children}</span>;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const timeText = (iso) => (timeKey(iso) ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : 'No time set');
const dayText = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * HR "Today" tab: what needs doing now, in the order a recruiter works the morning.
 *   Needs update  a date has passed and nobody has said what happened (the no-show list)
 *   Today         lineups and interviews happening today
 *   Tomorrow      confirm they are coming
 *   Gone quiet    nothing has moved for a few days
 * Everything is read from the same tracker list the Pipeline tab uses.
 */
export function TodayTab({ scope, scopeKey, setScopeKey, onOpenPipeline }) {
  const { user, roles } = useAuth();
  const { myTeamIds } = scope;
  const trackers = useFetch('/api/v1/trackers');
  const stagesByTemplate = useStagesByTemplate();
  const [now, setNow] = useState(() => new Date());
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [openResched, setOpenResched] = useState(null); // tracker id whose reschedule options are open
  const [pickedDay, setPickedDay] = useState('');
  const [asked, setAsked] = useState(() => new Set()); // WhatsApp opened this session, for the tomorrow rows

  const canWrite = can(roles, 'trackers', 'write');
  const canAdvance = can(roles, 'workflow_actions', 'advance');

  // A tab left open overnight must not keep showing yesterday: refresh when the person comes back to it.
  const { reload } = trackers;
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { setNow(new Date()); reload(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  useEffect(() => {
    if (!flash) return undefined;
    const id = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(id);
  }, [flash]);

  const mine = useMemo(() => {
    const all = (trackers.data?.trackers || []).filter((t) => myTeamIds.includes(t.teamId));
    return scopeKey === 'mine' ? all.filter((t) => t.assignedHr === user.id) : all;
  }, [trackers.data, myTeamIds, scopeKey, user.id]);

  const view = useMemo(() => buildToday(mine, now), [mine, now]);

  function nextStageOf(t) {
    const list = stagesByTemplate[t.workflowTemplateId] || [];
    const idx = list.findIndex((s) => s.id === t.currentStage?.id);
    return idx >= 0 ? list[idx + 1] || null : null;
  }

  async function run(t, request, done) {
    setBusyId(t.id);
    setError(null);
    try {
      await request();
      setOpenResched(null);
      setFlash(done);
      await trackers.reload();
    } catch (err) {
      setError(errorMessage(err, 'Could not save that. Please try again.'));
    } finally {
      setBusyId(null);
    }
  }

  const post = (t, path, body) => () => apiFetch(`/api/v1/trackers/${t.id}/${path}`, { method: 'POST', body });
  const reached = (item) => { const next = nextStageOf(item.tracker); if (next) run(item.tracker, post(item.tracker, 'advance', { nextStageId: next.id }), `${item.tracker.candidateName} moved to ${next.name}`); };
  const notComing = (item) => run(item.tracker, post(item.tracker, 'outcome', { outcome: 'not_coming', field: item.field }), `${item.tracker.candidateName} marked not coming`);
  const confirmed = (item) => run(item.tracker, post(item.tracker, 'outcome', { outcome: 'confirmed', field: item.field, forDate: item.day }), `${item.tracker.candidateName} confirmed for tomorrow`);
  const moveTo = (item, day) => run(item.tracker, () => apiFetch(`/api/v1/trackers/${item.tracker.id}`, { method: 'PATCH', body: { [item.field]: toIso(day, timeKey(item.date)) } }), `${item.tracker.candidateName} moved to ${dayText(day)}`);

  const open = (list) => list.filter((i) => !i.handled && !i.confirmed).length;
  const empty = view.late.length + view.today.length + view.tomorrow.length + view.quietTotal === 0;

  const rowProps = { busyId, canWrite, canAdvance, now, openResched, setOpenResched, pickedDay, setPickedDay, asked, setAsked, nextStageOf, reached, notComing, confirmed, moveTo };

  return (
    <>
      <div className="mb-4 inline-flex rounded-lg border bg-muted p-1" role="tablist" aria-label="Scope">
        {[['mine', 'My candidates'], ['team', 'Whole team']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={scopeKey === k} onClick={() => setScopeKey(k)}
            className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${scopeKey === k ? 'border bg-background shadow-sm' : 'border border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>

      <ErrorNote onRetry={trackers.reload}>{trackers.error}</ErrorNote>
      <ErrorNote>{error}</ErrorNote>
      <div aria-live="polite">{flash && <Notice tone="good" className="mb-4">{flash}</Notice>}</div>
      {trackers.loading && !trackers.data && <Loading />}

      {trackers.data && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <StatTile label="Needs update" value={view.late.length} tone={view.late.length ? 'bad' : 'default'} />
            <StatTile label="Today left" value={open(view.today)} />
            <StatTile label="To confirm" sub="tomorrow" value={open(view.tomorrow)} />
          </div>

          {empty && (
            <EmptyState title="Nothing needs you right now"
              body="No missed, today's or tomorrow's dates for these candidates. Set a lineup or interview date from the Pipeline tab and they will show up here."
              action={<Button variant="outline" size="sm" onClick={onOpenPipeline}>Open pipeline</Button>} />
          )}

          {view.late.length > 0 && (
            <Section title={`Needs update · ${view.late.length}`} hint="The date has passed and nobody has recorded what happened">
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{view.late.map((i) => <TodayRow key={i.tracker.id} item={i} {...rowProps} />)}</div>
            </Section>
          )}
          {view.today.length > 0 && (
            <Section title={`Today · ${view.today.length}`} hint="Lineups and interviews happening today">
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{view.today.map((i) => <TodayRow key={i.tracker.id} item={i} {...rowProps} />)}</div>
            </Section>
          )}
          {view.tomorrow.length > 0 && (
            <Section title={`Tomorrow · ${view.tomorrow.length}`} hint="Ask them to confirm today. It is the best way to cut no-shows">
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{view.tomorrow.map((i) => <TodayRow key={i.tracker.id} item={i} {...rowProps} />)}</div>
            </Section>
          )}
          {view.quietTotal > 0 && (
            <Section title={`Gone quiet · ${view.quietTotal}`} hint={`No movement for ${QUIET_DAYS} days or more, and nothing dated coming up`}>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{view.quiet.map((i) => <TodayRow key={i.tracker.id} item={{ ...i, bucket: 'quiet' }} {...rowProps} />)}</div>
              {view.quietTotal > view.quiet.length && (
                <p className="mt-3 text-sm text-muted-foreground">{view.quietTotal - view.quiet.length} more are in the Pipeline tab, ordered by stage.</p>
              )}
            </Section>
          )}
        </>
      )}
    </>
  );
}

function TodayRow({ item, busyId, canWrite, canAdvance, now, openResched, setOpenResched, pickedDay, setPickedDay, asked, setAsked, nextStageOf, reached, notComing, confirmed, moveTo }) {
  const t = item.tracker;
  const busy = busyId === t.id;
  const wa = whatsappUrl(t.candidatePhoneE164, t.candidatePhone, whatsappText(item));
  const next = nextStageOf(t);
  const isQuiet = item.bucket === 'quiet';
  const kindLabel = item.kind === 'interview' ? 'Interview' : 'Line-up';
  const resched = openResched === t.id;
  const waButtonLabel = item.bucket === 'tomorrow' ? 'Confirm on WhatsApp' : 'Message on WhatsApp';

  // Reschedule choices: today is only offered for a missed date; after that, the next few days.
  const options = [0, 1, 2, 3].filter((n) => item.bucket === 'late' || n > 0).slice(0, 3)
    .map((n) => { const key = dayOffset(now, n); return { key, label: n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : dayText(key) }; });

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={t.candidateName} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{t.candidateName}</div>
          <div className="truncate text-xs text-muted-foreground">{t.openPositionDesignation || 'No position'}{t.clientName ? ` · ${t.clientName}` : ''}</div>
          {t.candidateLocation && <div className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" aria-hidden /><span className="truncate">{t.candidateLocation}</span></div>}
        </div>
        {wa && <RoundAction href={wa} {...whatsappProps} aria-label={`WhatsApp ${t.candidateName}`} onClick={() => setAsked((s) => new Set(s).add(t.id))}><MessageCircle className="size-5" aria-hidden /></RoundAction>}
        {t.candidatePhone && <RoundAction tone="accent" href={`tel:${t.candidatePhone}`} aria-label={`Call ${t.candidateName}`}><Phone className="size-5" aria-hidden /></RoundAction>}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {isQuiet ? (
          <>
            <Pill>{t.currentStage?.name}</Pill>
            <Pill tone="warn">{plural(item.idleDays, 'day')} without movement</Pill>
          </>
        ) : (
          <>
            <Pill tone={item.bucket === 'late' ? 'late' : 'plain'}>{kindLabel}{item.bucket === 'late' ? ` · ${lineupLabel(item.date)}` : ` · ${timeText(item.date)}`}</Pill>
            {item.bucket === 'late' && <Pill tone="late">{plural(item.daysLate, 'day')} ago</Pill>}
            {t.rescheduleCount > 0 && <Pill tone="warn">Rescheduled {t.rescheduleCount}x</Pill>}
            {item.confirmed && <Pill tone="good"><Check className="mr-1 size-3" aria-hidden />Confirmed</Pill>}
            {item.handled && <Pill tone="muted">Marked not coming</Pill>}
            {item.bucket !== 'late' && t.currentStage && <Pill tone="muted">{t.currentStage.name}</Pill>}
          </>
        )}
      </div>

      {isQuiet ? (
        wa && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild><a href={wa} {...whatsappProps}><MessageCircle /> Nudge on WhatsApp</a></Button>
          </div>
        )
      ) : (
        <div className="flex flex-wrap gap-2">
          {item.bucket === 'tomorrow' && !item.confirmed && !item.handled && (
            <>
              {wa && <Button size="sm" variant={asked.has(t.id) ? 'outline' : 'default'} asChild><a href={wa} {...whatsappProps} onClick={() => setAsked((s) => new Set(s).add(t.id))}><MessageCircle /> {waButtonLabel}</a></Button>}
              {canWrite && <Button size="sm" variant={asked.has(t.id) || !wa ? 'default' : 'outline'} disabled={busy} onClick={() => confirmed(item)}><Check /> Confirmed</Button>}
            </>
          )}
          {(item.bucket === 'late' || item.bucket === 'today') && !item.handled && canAdvance && next && (
            <Button size="sm" disabled={busy} onClick={() => reached(item)}>{nextStepLabel(next)} <ArrowRight /></Button>
          )}
          {item.bucket !== 'tomorrow' && !item.handled && wa && (
            <Button size="sm" variant="outline" asChild><a href={wa} {...whatsappProps}><MessageCircle /> {waButtonLabel}</a></Button>
          )}
          {canWrite && !item.handled && <Button size="sm" variant="outline" disabled={busy} onClick={() => notComing(item)}><X /> Not coming</Button>}
          {canWrite && <Button size="sm" variant="outline" disabled={busy} aria-expanded={resched} onClick={() => { setOpenResched(resched ? null : t.id); setPickedDay(''); }}><CalendarClock /> Reschedule</Button>}
        </div>
      )}

      {resched && !isQuiet && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2" role="group" aria-label={`Move ${kindLabel.toLowerCase()} date for ${t.candidateName}`}>
          <span className="text-xs text-muted-foreground">Move to</span>
          {options.map((o) => <Button key={o.key} size="sm" variant="outline" disabled={busy} onClick={() => moveTo(item, o.key)}>{o.label}</Button>)}
          <Input type="date" aria-label="Another day" className="h-10 w-auto md:h-8" min={todayKey(0)} value={pickedDay} onChange={(e) => setPickedDay(e.target.value)} />
          <Button size="sm" disabled={busy || !pickedDay || pickedDay === dayKey(item.date)} onClick={() => moveTo(item, pickedDay)}>Save</Button>
        </div>
      )}
    </Card>
  );
}
