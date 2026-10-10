import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, Table2, ChevronDown, Send } from 'lucide-react';
import { Sheet, ErrorNote, Field, Notice, Loading, Chips } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ColumnPicker } from '../mail/ColumnPicker';
import { apiFetch } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { copyRich } from '../../lib/richCopy';
import { errorMessage } from '../../hooks/useFetch';

/**
 * Tracker mail for a client: HR picks one of the manager's templates, may
 * toggle columns for THIS send only, sees the table exactly as the client
 * will, and copies it (as a real table, as text, or as cells for Excel).
 * One mail per client location: To, CC and the template come from the client's
 * profile. Nothing is sent from here; "Mark as sent" records it once HR has sent
 * it from their own mail app. A mail never mixes two clients.
 */
export function TrackerMailSheet({ open, onClose, trackerIds }) {
  const [meta, setMeta] = useState({ templates: [], catalogue: [], error: null });
  const [templateId, setTemplateId] = useState('');       // '' = default columns
  const [custom, setCustom] = useState(null);             // per-send columns, null = use template
  const [tweak, setTweak] = useState(false);
  const [state, setState] = useState({ loading: false, error: null, messages: [] });
  const [idx, setIdx] = useState(0);
  const [subjects, setSubjects] = useState({});
  const [copied, setCopied] = useState(null);
  const [sent, setSent] = useState({});                    // mail index -> true once logged
  const [sending, setSending] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setTemplateId(''); setCustom(null); setTweak(false); setIdx(0); setSubjects({}); setCopied(null); setSent({});
    Promise.all([apiFetch('/api/v1/mail/templates'), apiFetch('/api/v1/mail/columns')])
      .then(([t, c]) => {
        if (cancelled) return;
        setMeta({ templates: t.data, catalogue: c.data, error: null });
      })
      .catch((err) => { if (!cancelled) setMeta({ templates: [], catalogue: [], error: errorMessage(err, 'Could not load the tracker templates.') }); });
    return () => { cancelled = true; clearTimeout(timer.current); };
  }, [open]);

  const columnsKey = custom ? custom.map((c) => `${c.key}:${c.label || ''}`).join(',') : '';
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const body = { type: 'tracker', trackerIds, ...(custom ? { columns: custom } : templateId ? { templateId } : {}) };
    apiFetch('/api/v1/mail/compose', { method: 'POST', body })
      .then((res) => { if (!cancelled) { setState({ loading: false, error: null, messages: res.data.messages }); setIdx(0); setSent({}); } })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: errorMessage(err, 'Could not build the tracker.'), messages: [] }); });
    return () => { cancelled = true; };
  }, [open, templateId, columnsKey, trackerIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const msg = state.messages[idx];
  const subject = subjects[idx] ?? msg?.subject ?? '';
  const template = meta.templates.find((t) => t.id === templateId) || meta.templates.find((t) => t.id === msg?.templateId);

  function flash(which, ok) {
    if (!ok) { setState((s) => ({ ...s, error: 'Your browser blocked copying. Try again, or select the table by hand.' })); return; }
    setCopied(which);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1500);
  }
  const copyTable = () => copyRich(msg.html, msg.text).then((ok) => flash('table', ok));
  const copyPlain = () => copyText(msg.text).then((ok) => flash('text', ok));
  const copyCells = () => copyText(msg.tsv).then((ok) => flash('cells', ok));

  function startTweak() {
    if (!custom) setCustom((template?.columns || []).length ? template.columns : defaultColumns(meta.catalogue));
    setTweak(true);
  }
  function pickTemplate(k) { setTemplateId(k === 'none' ? '' : k); setCustom(null); setTweak(false); }

  const items = [{ key: 'none', label: 'Auto' }, ...meta.templates.map((t) => ({ key: t.id, label: t.name }))];
  const clients = state.messages.map((m, i) => ({ key: String(i), label: [m.clientName || 'No client', m.locationName].filter(Boolean).join(' · '), count: m.candidateCount }));
  const toLine = (list) => list.map((r) => r.email).join('; ');

  async function markSent() {
    setSending(true);
    try {
      await apiFetch('/api/v1/mail/sent', { method: 'POST', body: {
        clientId: msg.clientId, locationId: msg.locationId, templateId: msg.templateId, subject,
        to: msg.to.map(({ name, email }) => ({ name, email })), cc: msg.cc.map(({ name, email }) => ({ name, email })), trackerIds: msg.trackerIds,
      } });
      setSent((x) => ({ ...x, [idx]: true }));
    } catch (err) {
      setState((s) => ({ ...s, error: errorMessage(err, 'Could not log the send. Your mail is unaffected; try again.') }));
    } finally { setSending(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} size="xl" title="Tracker mail"
      description="To, CC and columns are filled from the client's profile. Check, copy, send from your own mail, then mark it as sent.">
      <div className="flex flex-col gap-4">
        <ErrorNote>{meta.error}</ErrorNote>
        {meta.templates.length === 0 && !meta.error && (
          <Notice>No templates yet. Your manager can set them up under Managerial; until then the standard columns are used.</Notice>
        )}
        <p className="-mb-2 text-xs text-muted-foreground">Template: Auto uses each location's own template. Pick one to use it for every mail here.</p>
        <Chips items={items} value={templateId || 'none'} onChange={pickTemplate} />

        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => (tweak ? setTweak(false) : startTweak())} aria-expanded={tweak}>
            <Table2 /> Columns for this send {custom ? '(changed)' : ''} <ChevronDown className={tweak ? 'rotate-180' : ''} />
          </Button>
          {tweak && custom && (
            <div className="mt-3 rounded-xl border p-3">
              <ColumnPicker catalogue={meta.catalogue} value={custom} onChange={setCustom} />
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Only this mail changes. The template stays as your manager set it.</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setCustom(null); setTweak(false); }}>Reset</Button>
              </div>
            </div>
          )}
        </div>

        {state.loading && <Loading label="Building the tracker…" />}
        <ErrorNote>{state.error}</ErrorNote>
        {clients.length > 1 && <Chips items={clients} value={String(idx)} onChange={(k) => { setIdx(Number(k)); setCopied(null); }} />}
        {clients.length > 1 && <Notice>Each client and location gets its own mail, so no client sees another's candidates.</Notice>}

        {msg && (
          <>
            {msg.locationUnmatched && (
              <Notice tone="warn" title="Some candidates fit none of this client's locations">
                These candidates are in a separate mail using the client-wide contacts.{' '}
                {msg.clientId && <Link to={`/clients/${msg.clientId}`} className="font-medium underline">Fix locations</Link>}
              </Notice>
            )}
            {msg.clientId && msg.to.length === 0 && msg.cc.length === 0 && (
              <Notice tone="warn" title="No contacts set up for this mail">
                Add who it goes to on the client's profile.{' '}<Link to={`/clients/${msg.clientId}`} className="font-medium underline">Open profile</Link>
              </Notice>
            )}
            {(msg.to.length > 0 || msg.cc.length > 0) && (
              <div className="grid gap-2 rounded-xl border p-3 text-sm">
                {[['To', msg.to, 'to'], ['CC', msg.cc, 'cc']].filter(([, l]) => l.length).map(([label, list, k]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
                    <span className="min-w-0 flex-1 break-words">{list.map((r) => r.name ? `${r.name} <${r.email}>` : r.email).join(', ')}</span>
                    <Button type="button" variant="outline" size="icon" aria-label={`Copy ${label} addresses`} onClick={() => copyText(toLine(list)).then((ok) => flash(k, ok))}>
                      {copied === k ? <Check /> : <Copy />}
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">{msg.recipientsFrom === 'client' ? 'From the client-wide contacts.' : `From the ${msg.locationName || 'client'} profile.`}</p>
              </div>
            )}
            <Field label="Subject" htmlFor="tm-subject">
              <div className="flex gap-2">
                <Input id="tm-subject" value={subject} onChange={(e) => setSubjects((s) => ({ ...s, [idx]: e.target.value }))} />
                <Button type="button" variant="outline" size="icon" aria-label="Copy subject" onClick={() => copyText(subject).then((ok) => flash('subject', ok))}>
                  {copied === 'subject' ? <Check /> : <Copy />}
                </Button>
              </div>
            </Field>

            {/* Server-built, and every cell is escaped there; this is the mail as the client sees it. */}
            <div className="max-h-96 overflow-auto rounded-xl border bg-white p-3 text-black" dangerouslySetInnerHTML={{ __html: msg.html }} />

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" size="lg" className="flex-1" onClick={copyTable}>
                {copied === 'table' ? <><Check /> Copied</> : <><Copy /> Copy table</>}
              </Button>
              <Button type="button" variant="outline" size="lg" className="flex-1" onClick={copyCells}>
                {copied === 'cells' ? <><Check /> Copied</> : <>Copy for Excel</>}
              </Button>
              <Button type="button" variant="outline" size="lg" className="flex-1" onClick={copyPlain}>
                {copied === 'text' ? <><Check /> Copied</> : <>Copy as text</>}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{msg.candidateCount} {msg.candidateCount === 1 ? 'candidate' : 'candidates'}. "Copy table" pastes as a formatted table into Outlook or Gmail.</p>
            {msg.clientId && (
              <div className="border-t pt-3">
                {sent[idx]
                  ? <Notice tone="good">Logged as sent. It now shows in this client's sent history.</Notice>
                  : (
                    <div className="flex flex-col items-start gap-1.5">
                      <Button type="button" variant="secondary" size="lg" className="w-full sm:w-auto" disabled={sending} onClick={markSent}><Send /> {sending ? 'Logging…' : 'Mark as sent'}</Button>
                      <p className="text-xs text-muted-foreground">Tap after you have sent it from your own mail app. This only records it.</p>
                    </div>
                  )}
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function defaultColumns(catalogue) {
  const keys = ['candidate_name', 'mobile', 'position', 'location', 'lineup_time'];
  return keys.filter((k) => catalogue.some((c) => c.key === k)).map((key) => ({ key }));
}
