import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Sheet, ErrorNote, Notice, Loading } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ColumnSwitches } from '../mail/ColumnSwitches';
import { useTrackerMail } from '../../hooks/useTrackerMail';
import { cn } from '@/lib/utils';

/**
 * Tracker Mail on a phone, the design's bottom sheet: client pills, who it goes to and
 * which template, Columns and Subject one tap away, the table to scroll sideways, and
 * Copy Table / Copy as Text / Mark as Sent at the bottom. Desktop uses EmailTrackerPage.
 */
export function TrackerMailSheet({ open, onClose, trackerIds }) {
  const m = useTrackerMail(trackerIds, open);
  const { msg, state, meta } = m;
  const [panel, setPanel] = useState(null);       // 'columns' | 'subject'
  const pills = state.messages.map((x, i) => ({ i, text: [x.clientName || 'No client', state.messages.filter((y) => y.clientId === x.clientId).length > 1 ? x.locationName : null].filter(Boolean).join(' · '), n: x.candidateCount }));

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Tracker Mail">
        <div className="flex flex-col gap-3">
          {pills.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
              {pills.map((p) => (
                <button key={p.i} type="button" role="tab" aria-selected={p.i === m.idx} onClick={() => m.setIdx(p.i)}
                  className={cn('h-10 shrink-0 rounded-full border px-4 text-sm', p.i === m.idx ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>
                  {p.text} · {p.n}
                </button>
              ))}
            </div>
          )}
          <ErrorNote>{meta.error || state.error}</ErrorNote>
          {state.loading && !msg && <Loading />}

          {msg && (
            <>
              {(msg.locationUnmatched || (msg.clientId && msg.to.length === 0)) && (
                <Notice tone="warn" title={msg.to.length === 0 ? 'No contact set up for this mail' : 'Some candidates fit no location'}>
                  {msg.clientId && <Link to={`/clients/${msg.clientId}`} className="font-medium underline">Open the client profile</Link>}
                </Notice>
              )}
              <div className="rounded-xl border p-3 text-sm leading-snug">
                <div className="text-xs text-muted-foreground">To</div>
                <div>{msg.to.length ? msg.to.map((r) => (r.name ? `${r.name}${msg.locationName ? ` · ${msg.locationName}` : ''}` : r.email)).join(', ') : '—'}</div>
                {msg.cc.length > 0 && <><div className="mt-1 text-xs text-muted-foreground">CC</div><div>{msg.cc.map((r) => r.name).join(', ')}</div></>}
                <div className="mt-1 text-xs text-muted-foreground">Template</div>
                <NativeSelect aria-label="Template" className="mt-0.5 h-9" value={m.templateId} onChange={(e) => m.setTemplateId(e.target.value)}>
                  <option value="">{msg.templateName ? `${msg.templateName} (auto)` : 'Standard (auto)'}</option>
                  {meta.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
                {(msg.to.length > 0 || msg.cc.length > 0) && (
                  <div className="mt-2 flex gap-2">
                    {msg.to.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => m.copyAddresses('to', msg.to)}>{m.copied === 'to' ? <Check /> : null} Copy To</Button>}
                    {msg.cc.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => m.copyAddresses('cc', msg.cc)}>{m.copied === 'cc' ? <Check /> : null} Copy CC</Button>}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="lg" onClick={() => setPanel('columns')}>Columns ({m.columns.length})</Button>
                <Button type="button" variant="outline" size="lg" onClick={() => setPanel('subject')}>Subject…</Button>
              </div>
              <div className="text-xs text-muted-foreground">Preview · scroll sideways →</div>
              <div className={cn('max-h-72 overflow-auto rounded-lg border bg-[#FAFBFD] p-2 text-black', state.loading && 'opacity-60')} dangerouslySetInnerHTML={{ __html: msg.html }} />
              <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t bg-background px-1 pb-1 pt-3">
                <Button type="button" size="lg" onClick={m.copyTable}>{m.copied === 'table' ? <><Check /> Copied. Paste it into your mail</> : 'Copy Table'}</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="lg" onClick={m.copyPlain}>{m.copied === 'text' ? 'Copied' : 'Copy as Text'}</Button>
                  <Button type="button" variant="outline" size="lg" disabled={m.sending || m.isSent || !msg.clientId} onClick={m.markSent}>{m.isSent ? '✓ Sent' : m.sending ? 'Logging…' : 'Mark as Sent'}</Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Sheet>

      <Sheet open={open && panel === 'columns'} onClose={() => setPanel(null)} title="Columns" description="Changes apply to this send only.">
        {msg && <ColumnSwitches catalogue={meta.catalogue} value={m.columns} onChange={(next) => m.setColumns(next)} />}
        {m.customised && <Button type="button" variant="ghost" className="mt-2" onClick={m.resetColumns}>Reset to Template</Button>}
        <Button type="button" size="lg" className="mt-3 w-full" onClick={() => setPanel(null)}>Done</Button>
      </Sheet>
      <Sheet open={open && panel === 'subject'} onClose={() => setPanel(null)} title="Subject">
        {msg && <Input aria-label="Subject" value={m.subject} onChange={(e) => m.setSubject(e.target.value)} />}
        <Button type="button" size="lg" className="mt-3 w-full" onClick={() => setPanel(null)}>Done</Button>
      </Sheet>
    </>
  );
}
