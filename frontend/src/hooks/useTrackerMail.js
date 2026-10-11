import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { copyRich } from '../lib/richCopy';
import { errorMessage } from './useFetch';

const STANDARD = ['candidate_name', 'mobile', 'position', 'location', 'lineup_time'];

/**
 * Everything behind the tracker-mail screens (desktop page and phone sheet):
 * templates + column catalogue, composing one mail per client location from the
 * client profile, per-send column toggles, copy actions, and "mark as sent".
 */
export function useTrackerMail(trackerIds, active = true, extra = {}) {
  const [meta, setMeta] = useState({ templates: [], catalogue: [], error: null });
  const [templateId, setTemplateId] = useState('');          // '' = Auto (the location's template)
  const [custom, setCustom] = useState(null);                // per-send columns; null = from template
  const [toPick, setToPick] = useState({});                  // mail key -> [emails]
  const [state, setState] = useState({ loading: false, error: null, messages: [] });
  const [idx, setIdx] = useState(0);
  const [subjects, setSubjects] = useState({});
  const [copied, setCopied] = useState(null);
  const [sent, setSent] = useState({});
  const [sending, setSending] = useState(false);
  const timer = useRef(null);
  const idsKey = trackerIds.join(',');
  // The Email Tracker tab says which kind of mail this is, which client, and which day.
  // The workbench shortcut sends none of these and keeps the older behaviour.
  const { mailType, date, clientId } = extra;
  const extraKey = [mailType, date, clientId].join('|');

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setTemplateId(''); setCustom(null); setToPick({}); setIdx(0); setSubjects({}); setCopied(null); setSent({});
    Promise.all([apiFetch('/api/v1/mail/templates'), apiFetch('/api/v1/mail/columns')])
      .then(([t, c]) => { if (!cancelled) setMeta({ templates: t.data, catalogue: c.data, error: null }); })
      .catch((err) => { if (!cancelled) setMeta({ templates: [], catalogue: [], error: errorMessage(err, 'Could not load the tracker templates.') }); });
    return () => { cancelled = true; clearTimeout(timer.current); };
  }, [active, idsKey, extraKey]);

  const columnsKey = custom ? custom.map((c) => `${c.key}:${c.label || ''}`).join(',') : '';
  const pickKey = JSON.stringify(toPick);
  useEffect(() => {
    if (!active || !trackerIds.length) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const body = { type: 'tracker', trackerIds, toPick, ...(mailType ? { mailType } : {}), ...(date ? { date } : {}), ...(mailType && clientId ? { clientId } : {}), ...(custom ? { columns: custom } : templateId ? { templateId } : {}) };
    apiFetch('/api/v1/mail/compose', { method: 'POST', body })
      .then((res) => { if (!cancelled) setState({ loading: false, error: null, messages: res.data.messages }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: errorMessage(err, 'Could not build the tracker.'), messages: [] }); });
    return () => { cancelled = true; };
  }, [active, templateId, columnsKey, pickKey, idsKey, extraKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const msg = state.messages[Math.min(idx, Math.max(0, state.messages.length - 1))];
  const subject = subjects[msg?.key] ?? msg?.subject ?? '';
  const sentKey = msg?.key;

  // The columns this mail uses now, with their headings: this send's toggles, else the template's.
  const template = meta.templates.find((t) => t.id === (templateId || msg?.templateId));
  const baseColumns = custom || (template?.columns?.length ? template.columns : (msg?.columns || []).map((key) => ({ key })));
  const defaults = () => STANDARD.filter((k) => meta.catalogue.some((c) => c.key === k)).map((key) => ({ key }));
  const fromTemplate = () => (template?.columns?.length ? template.columns : defaults());

  const flash = (which, ok) => {
    if (!ok) { setState((s) => ({ ...s, error: 'Your browser blocked copying. Try again, or select the table by hand.' })); return; }
    setCopied(which);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1800);
  };

  async function markSent() {
    setSending(true);
    try {
      await apiFetch('/api/v1/mail/sent', { method: 'POST', body: {
        clientId: msg.clientId, locationId: msg.locationId, templateId: msg.templateId, mailType: msg.mailType || undefined, subject,
        to: msg.to.map(({ name, email }) => ({ name, email })), cc: msg.cc.map(({ name, email }) => ({ name, email })), trackerIds: msg.trackerIds,
      } });
      setSent((x) => ({ ...x, [sentKey]: true }));
    } catch (err) {
      setState((s) => ({ ...s, error: errorMessage(err, 'Could not log the send. Your mail is unaffected; try again.') }));
    } finally { setSending(false); }
  }

  return {
    meta, state, msg, idx, setIdx, subject, setSubject: (v) => setSubjects((x) => ({ ...x, [msg.key]: v })),
    templateId, setTemplateId: (v) => { setTemplateId(v); setCustom(null); },
    columns: baseColumns, setColumns: setCustom, resetColumns: () => setCustom(null), customised: !!custom, startColumns: () => setCustom(fromTemplate()),
    pickTo: (emails) => setToPick((x) => ({ ...x, [msg.key]: emails })), toPick,
    copied, copyTable: () => copyRich(msg.html, msg.text).then((ok) => flash('table', ok)),
    copyPlain: () => copyText(msg.text).then((ok) => flash('text', ok)), copyCells: () => copyText(msg.tsv).then((ok) => flash('cells', ok)),
    copyAddresses: (which, list) => copyText(list.map((r) => r.email).join('; ')).then((ok) => flash(which, ok)),
    isSent: !!sent[sentKey], sending, markSent,
  };
}
