import { Link, useNavigate } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { ErrorNote, Notice, Loading } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ColumnSwitches } from '../components/mail/ColumnSwitches';
import { useTrackerMail } from '../hooks/useTrackerMail';
import { cn } from '@/lib/utils';

export const TRACKER_IDS_KEY = 'jopup.trackerMailIds';
export const readTrackerIds = () => { try { return JSON.parse(sessionStorage.getItem(TRACKER_IDS_KEY) || '[]'); } catch { return []; } };

const label = 'text-[13px] font-medium';

/** Email Tracker, the full-page desktop screen: settings on the left, the mail as the client sees it on the right. */
export function EmailTrackerPage() {
  const navigate = useNavigate();
  const ids = readTrackerIds();
  const m = useTrackerMail(ids, ids.length > 0);
  const { msg, state, meta } = m;
  const step = m.copied === 'table' || m.copied === 'cells' || m.copied === 'text' || m.isSent ? 3 : 2;
  const pills = state.messages.map((x, i) => ({ i, text: [x.clientName || 'No client', state.messages.filter((y) => y.clientId === x.clientId).length > 1 ? x.locationName : null].filter(Boolean).join(' · '), n: x.candidateCount }));
  const picked = msg ? m.toPick[msg.key] : null;
  const toValue = picked?.length === 1 ? picked[0] : 'all';

  return (
    <AppLayout wide>
      <div className="flex items-center gap-3 text-[13px] text-muted-foreground" aria-label="Steps">
        <b className="font-semibold text-primary">1 Pick Client</b>›
        <b className={cn('font-semibold', step === 2 ? 'text-foreground' : 'text-primary')}>2 Review Mail</b>›
        <span className={cn(step === 3 && 'font-semibold text-foreground')}>3 Copy &amp; Send</span>
      </div>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Email Tracker</h1>
          <p className="text-sm text-muted-foreground">One mail per client. Candidates from different clients are never mixed.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Client mails">
          {pills.map((p) => (
            <button key={p.i} type="button" role="tab" aria-selected={p.i === m.idx} onClick={() => m.setIdx(p.i)}
              className={cn('inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium', p.i === m.idx ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent')}>
              {p.text} · {p.n}
            </button>
          ))}
        </div>
      </div>

      {ids.length === 0 && (
        <Notice title="No candidates picked">Go back to the HR workbench, select candidates (or none for everyone active) and tap Email Tracker. <Link to="/hr" className="font-medium underline">HR workbench</Link></Notice>
      )}
      <ErrorNote>{meta.error || state.error}</ErrorNote>
      {state.loading && !msg && <Loading />}

      {msg && (
        <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
          <div className="rounded-xl border bg-card p-[18px]">
            {msg.locationUnmatched && (
              <Notice tone="warn" title="Some candidates fit none of this client's locations" className="mb-3">
                They are in their own mail, using the client-wide contacts. <Link to={`/clients/${msg.clientId}`} className="font-medium underline">Fix locations</Link>
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
              <Button type="button" size="lg" onClick={m.copyTable}>{m.copied === 'table' ? <Check /> : null} Copy Table</Button>
              <Button type="button" size="lg" variant="outline" onClick={m.copyCells}>Copy for Excel</Button>
              <Button type="button" size="lg" variant="outline" onClick={m.copyPlain}>Copy as Text</Button>
              <span role="status" className="ml-auto text-[13px] text-emerald-700">{['table', 'cells', 'text'].includes(m.copied) ? `✓ ${m.copied === 'table' ? 'Table' : m.copied === 'cells' ? 'Cells' : 'Text'} copied. Paste it into your mail…` : ''}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4 text-[13px] text-muted-foreground">
              {m.isSent ? <span className="font-medium text-emerald-700">✓ Logged as sent. It shows in this client's sent history.</span> : (
                <>
                  After you send:
                  <Button type="button" variant="outline" disabled={m.sending || !msg.clientId} onClick={m.markSent}>{m.sending ? 'Logging…' : 'Mark as Sent'}</Button>
                  logs it in {msg.clientName ? `${msg.clientName}'s` : 'the'} sent history.
                </>
              )}
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => navigate('/hr')}>Back to workbench</Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
