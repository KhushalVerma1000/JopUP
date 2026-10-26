import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { ErrorNote, Notice, Loading, PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ColumnSwitches } from '../components/mail/ColumnSwitches';
import { MailPicker } from '../components/mail/MailPicker';
import { PendingMails } from '../components/mail/PendingMails';
import { OpenedNote, OpenInMailButton, ProviderSelect } from '../components/mail/OpenInMail';
import { ReadyChecks } from '../components/mail/ReadyChecks';
import { useTrackerMail } from '../hooks/useTrackerMail';
import { cn } from '@/lib/utils';

export const TRACKER_IDS_KEY = 'jopup.trackerMailIds';
export const readTrackerIds = () => { try { return JSON.parse(sessionStorage.getItem(TRACKER_IDS_KEY) || '[]'); } catch { return []; } };

const label = 'text-[13px] font-medium';

const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const KEYS = ['type', 'client', 'loc', 'date'];

/**
 * Email Tracker: its own tab. Pick what you are sending, then client, hiring location and
 * date, and the mail appears ready to copy. The HR workbench's "Email Tracker" button still
 * lands here with its selected candidates (?from=hr) and skips the picker.
 */
export function EmailTrackerPage() {
  const [params, setParams] = useSearchParams();
  const fromHr = params.get('from') === 'hr';
  const value = Object.fromEntries(KEYS.map((k) => [k, params.get(k) || '']));
  const onPick = (next) => setParams(Object.fromEntries(KEYS.filter((k) => next[k]).map((k) => [k, next[k]])), { replace: true });
  const [ready, setReady] = useState(null);

  const ids = fromHr ? readTrackerIds() : ready?.trackerIds || [];
  // From the workbench right after setting dates: the same mail type and day the picker would build.
  const hrType = ['lineup', 'interview_schedule'].includes(params.get('type')) ? params.get('type') : undefined;
  const hrDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : undefined;
  const m = useTrackerMail(ids, ids.length > 0, fromHr ? { mailType: hrType, date: hrType ? hrDate : undefined } : { mailType: ready?.kind?.key, date: value.date || undefined, clientId: value.client || undefined });
  const { state, meta } = m;
  const msg = ids.length > 0 ? m.msg : null;
  const step = !ids.length ? 1 : m.copied === 'table' || m.copied === 'cells' || m.copied === 'text' || m.opened || m.isSent ? 3 : 2;
  const pills = state.messages.map((x, i) => ({ i, text: [x.clientName || 'No client', state.messages.filter((y) => y.clientId === x.clientId).length > 1 ? x.locationName : null].filter(Boolean).join(' · '), n: x.candidateCount }));
  const picked = msg ? m.toPick[msg.key] : null;
  const toValue = picked?.length === 1 ? picked[0] : 'all';
  const hasError = !!msg?.checks?.some((c) => c.level === 'error');

  return (
    <AppLayout wide>
      <PageHeader title="Email Tracker" subtitle={fromHr ? 'One mail per client. Candidates from different clients are never mixed.' : 'Pick what to send, for which client, where and when. The mail is built for you.'} />
      <div className="mb-4 flex items-center gap-3 text-[13px] text-muted-foreground" aria-label="Steps">
        <b className={cn('font-semibold', step === 1 ? 'text-foreground' : 'text-primary')}>1 Pick</b>›
        <b className={cn('font-semibold', step === 2 ? 'text-foreground' : step > 2 ? 'text-primary' : 'font-normal')}>2 Review</b>›
        <span className={cn(step === 3 && 'font-semibold text-foreground')}>3 Copy &amp; Send</span>
      </div>

      {fromHr ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Built from the candidates you picked in the HR workbench. <Link to="/email-tracker" className="font-medium text-primary underline">Pick by client, location and date instead</Link></p>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Client mails">
            {pills.map((p) => (
              <button key={p.i} type="button" role="tab" aria-selected={p.i === m.idx} onClick={() => m.setIdx(p.i)}
                className={cn('inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium', p.i === m.idx ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent')}>
                {p.text} · {p.n}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <PendingMails value={value} onPick={onPick} refreshKey={m.isSent} />
          <MailPicker value={value} onChange={onPick} onReady={setReady} />
          {pills.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Mails for this client">
              {pills.map((p) => (
                <button key={p.i} type="button" role="tab" aria-selected={p.i === m.idx} onClick={() => m.setIdx(p.i)}
                  className={cn('inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium', p.i === m.idx ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent')}>
                  {p.text} · {p.n}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {fromHr && ids.length === 0 && (
        <Notice title="No candidates picked">Go back to the HR workbench, select candidates (or none for everyone active) and tap Email Tracker, or <Link to="/email-tracker" className="font-medium underline">pick by client, location and date</Link>.</Notice>
      )}
      <ErrorNote>{meta.error || state.error}</ErrorNote>
      {ids.length > 0 && state.loading && !msg && <Loading />}

      {msg && (
        <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
          <div className="rounded-xl border bg-card p-[18px]">
            <ReadyChecks checks={msg.checks} className="mb-3.5" />
            {msg.alreadySent && !m.isSent && (
              <Notice tone="warn" title="You already sent this" className="mb-3.5">
                {msg.alreadySent.by ? `${msg.alreadySent.by} logged` : 'It was logged'} the same mail on {when(msg.alreadySent.at)}. Sending again repeats it.
              </Notice>
            )}
            <label className={cn('mb-3.5 block', label)}>To
              <NativeSelect className="mt-1.5 font-normal" value={toValue} disabled={msg.toAll.length === 0}
                onChange={(e) => m.pickTo(e.target.value === 'all' ? [] : [e.target.value])}>
                {msg.toAll.length === 0 && <option value="all">No contact set up</option>}
                {msg.toAll.length > 1 && <option value="all">All {msg.toAll.length}: {msg.toAll.map((r) => r.name).join(', ')}</option>}
                {msg.toAll.map((r) => <option key={r.email} value={r.email}>{r.name}{msg.locationName ? ` · ${msg.locationName}` : ''}</option>)}
              </NativeSelect>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {msg.toAll.length === 0 ? 'Add who this goes to on the client profile.' : msg.recipientsFrom === 'client' ? 'From the client-wide contacts.' : `From the client's ${msg.locationName} location.`}{' '}
                {msg.clientId && <Link to={`/clients/${msg.clientId}`} className="text-primary underline">Change contact…</Link>}
              </span>
            </label>
            {(msg.to.length > 0 || msg.cc.length > 0) && (
              <div className="-mt-1.5 mb-3.5 flex flex-wrap items-center gap-2 text-xs">
                {msg.to.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => m.copyAddresses('to', msg.to)}>{m.copied === 'to' ? <Check /> : <Copy />} Copy To</Button>}
                {msg.cc.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => m.copyAddresses('cc', msg.cc)}>{m.copied === 'cc' ? <Check /> : <Copy />} Copy CC</Button>}
                {msg.cc.length > 0 && <span className="text-muted-foreground">CC {msg.cc.map((r) => r.name).join(', ')}</span>}
              </div>
            )}

            <label className={cn('mb-3.5 block', label)}>Template
              <NativeSelect className="mt-1.5 font-normal" value={m.templateId} onChange={(e) => m.setTemplateId(e.target.value)}>
                <option value="">{msg.templateName ? `${msg.templateName} (auto)` : 'Standard (auto)'}</option>
                {meta.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            </label>
            <label className={cn('mb-4 block', label)}>Subject
              <Input className="mt-1.5 font-normal" value={m.subject} onChange={(e) => m.setSubject(e.target.value)} />
            </label>

            <div className="flex items-baseline justify-between">
              <b className="text-[13px] font-semibold">Columns</b>
              {m.customised && <button type="button" onClick={m.resetColumns} className="py-2 text-[13px] font-medium text-primary hover:underline">Reset to Template</button>}
            </div>
            <div className="mb-1.5 text-xs text-muted-foreground">Changes apply to this send only. The template stays as it is.</div>
            <div className="max-h-[420px] overflow-y-auto">
              <ColumnSwitches catalogue={meta.catalogue} value={m.columns} onChange={(next) => m.setColumns(next)} />
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <b className="text-sm font-semibold">Preview — how the client sees it</b>
              <span className="text-xs text-muted-foreground">{msg.candidateCount} {msg.candidateCount === 1 ? 'candidate' : 'candidates'}</span>
            </div>
            <div className={cn('overflow-x-auto rounded-lg border bg-[#FAFBFD] p-4 text-black transition-opacity', state.loading && 'opacity-60')} dangerouslySetInnerHTML={{ __html: msg.html }} />
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <OpenInMailButton m={m} />
              <ProviderSelect m={m} className="h-11 w-auto min-w-[180px] text-[13px]" />
              <Button type="button" size="lg" variant="outline" onClick={m.copyTable}>{m.copied === 'table' ? <Check /> : null} Copy Table</Button>
              <Button type="button" size="lg" variant="outline" onClick={m.copyCells}>Copy for Excel</Button>
              <Button type="button" size="lg" variant="outline" onClick={m.copyPlain}>Copy as Text</Button>
              <span role="status" className="ml-auto text-[13px] text-emerald-700">{['table', 'cells', 'text'].includes(m.copied) ? `✓ ${m.copied === 'table' ? 'Table' : m.copied === 'cells' ? 'Cells' : 'Text'} copied. Paste it into your mail…` : ''}</span>
            </div>
            <OpenedNote m={m} className="mt-3" />
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4 text-[13px] text-muted-foreground">
              {m.isSent ? <span className="font-medium text-emerald-700">✓ Logged as sent. It shows in this client's sent history.</span> : (
                <>
                  After you send:
                  <Button type="button" variant={m.opened ? 'default' : 'outline'} disabled={m.sending || !msg.clientId || hasError} onClick={m.markSent}>{m.sending ? 'Logging…' : 'Mark as Sent'}</Button>
                  logs it in {msg.clientName ? `${msg.clientName}'s` : 'the'} sent history.
                </>
              )}
              {fromHr && <Link to="/hr" className="ml-auto text-[13px] font-medium text-primary hover:underline">Back to workbench</Link>}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
