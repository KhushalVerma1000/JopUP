import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Table2, ChevronDown } from 'lucide-react';
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
 * Nothing is sent from here. One mail per client — a mail never mixes two.
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
  const timer = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setTemplateId(''); setCustom(null); setTweak(false); setIdx(0); setSubjects({}); setCopied(null);
    Promise.all([apiFetch('/api/v1/mail/templates'), apiFetch('/api/v1/mail/columns')])
      .then(([t, c]) => {
        if (cancelled) return;
        const templates = t.data;
        setMeta({ templates, catalogue: c.data, error: null });
        const def = templates.find((x) => x.isDefault) || templates[0];
        if (def) setTemplateId(def.id);
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
      .then((res) => { if (!cancelled) { setState({ loading: false, error: null, messages: res.data.messages }); setIdx(0); } })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: errorMessage(err, 'Could not build the tracker.'), messages: [] }); });
    return () => { cancelled = true; };
  }, [open, templateId, columnsKey, trackerIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const msg = state.messages[idx];
  const subject = subjects[idx] ?? msg?.subject ?? '';
  const template = meta.templates.find((t) => t.id === templateId);

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

  const items = [{ key: 'none', label: 'Standard' }, ...meta.templates.map((t) => ({ key: t.id, label: t.name }))];
  const clients = state.messages.map((m, i) => ({ key: String(i), label: m.clientName || 'No client' }));

  return (
    <Sheet open={open} onClose={onClose} size="xl" title="Tracker mail"
      description="Pick a template, adjust the columns for this send if you need to, then copy. Nothing is sent from here.">
      <div className="flex flex-col gap-4">
        <ErrorNote>{meta.error}</ErrorNote>
        {meta.templates.length === 0 && !meta.error && (
          <Notice>No templates yet. Your manager can set them up under Managerial; until then the standard columns are used.</Notice>
        )}
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
        {clients.length > 1 && <Notice>Candidates for different clients are in separate mails, so no client sees another's candidates.</Notice>}

        {msg && (
          <>
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
