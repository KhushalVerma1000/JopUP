import { useEffect, useRef, useState } from 'react';
import { Copy, Check, MessageCircle } from 'lucide-react';
import { Sheet, ErrorNote, Field, Notice, Loading, Chips } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../hooks/useFetch';

const TITLES = { lineup: 'Lineup mail', interview_reminder: 'Interview reminder' };

/**
 * Builds a mail for a day-to-day HR task from what the screen is showing, lets
 * HR edit it, and copies it. Nothing is sent from here — HR pastes it into
 * their own mail app. (A Send button arrives with the mail provider.)
 *
 * The server returns one message per client for a lineup (a mail never mixes
 * two clients) and one per candidate for reminders; `picker` switches between.
 */
export function MailComposeSheet({ open, onClose, type, trackerIds, date, whatsappFor }) {
  const [state, setState] = useState({ loading: false, error: null, messages: [] });
  const [idx, setIdx] = useState(0);
  const [edits, setEdits] = useState({});     // idx -> { subject, text }
  const [copied, setCopied] = useState(null); // 'subject' | 'body'
  const timer = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState({ loading: true, error: null, messages: [] });
    setIdx(0); setEdits({}); setCopied(null);
    apiFetch('/api/v1/mail/compose', { method: 'POST', body: { type, trackerIds, ...(date ? { date } : {}) } })
      .then((res) => { if (!cancelled) setState({ loading: false, error: null, messages: res.data.messages }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: errorMessage(err, 'Could not build the mail.'), messages: [] }); });
    return () => { cancelled = true; clearTimeout(timer.current); };
    // trackerIds is a fresh array each render; its content is what matters.
  }, [open, type, date, trackerIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const msg = state.messages[idx];
  const edit = edits[idx] || {};
  const subject = edit.subject ?? msg?.subject ?? '';
  const text = edit.text ?? msg?.text ?? '';
  const setEdit = (patch) => setEdits((e) => ({ ...e, [idx]: { ...e[idx], ...patch } }));

  async function copy(which) {
    const ok = await copyText(which === 'subject' ? subject : text);
    if (ok) {
      setCopied(which);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    } else {
      setState((s) => ({ ...s, error: 'Your browser blocked copying. Press and hold the text to copy it by hand.' }));
    }
  }

  const items = state.messages.map((m, i) => ({ key: String(i), label: m.clientName || m.candidateName || (type === 'lineup' ? 'No client' : `Candidate ${i + 1}`) }));
  const wa = msg && whatsappFor ? whatsappFor(msg, idx) : null;

  return (
    <Sheet open={open} onClose={onClose} title={TITLES[type] || 'Mail'}
      description="Edit if you like, then copy it into your mail app. Nothing is sent from here.">
      <div className="flex flex-col gap-4">
        {state.loading && <Loading label="Building the mail…" />}
        <ErrorNote>{state.error}</ErrorNote>

        {items.length > 1 && <Chips items={items} value={String(idx)} onChange={(k) => { setIdx(Number(k)); setCopied(null); }} />}

        {msg && (
          <>
            {type === 'lineup' && msg.missingLineupDate > 0 && (
              <Notice tone="warn" title={`${msg.missingLineupDate} ${msg.missingLineupDate === 1 ? 'candidate has' : 'candidates have'} no lineup date`}>
                They're listed without a time. Set their lineup date on the pipeline card for a complete mail.
              </Notice>
            )}
            {type === 'interview_reminder' && msg.missingInterviewDate && (
              <Notice tone="warn" title="No interview date set">The reminder has no date in it yet.</Notice>
            )}
            {type === 'interview_reminder' && !msg.candidateEmail && (
              <Notice>This candidate has no email on file. Copy the text and send it by WhatsApp instead.</Notice>
            )}

            <Field label="Subject" htmlFor="mc-subject">
              <div className="flex gap-2">
                <Input id="mc-subject" value={subject} onChange={(e) => setEdit({ subject: e.target.value })} />
                <Button type="button" variant="outline" size="icon" aria-label={copied === 'subject' ? 'Subject copied' : 'Copy subject'} onClick={() => copy('subject')}>
                  {copied === 'subject' ? <Check /> : <Copy />}
                </Button>
              </div>
            </Field>
            <Field label="Message" htmlFor="mc-body">
              <Textarea id="mc-body" rows={12} value={text} onChange={(e) => setEdit({ text: e.target.value })} className="font-mono text-sm leading-relaxed" />
            </Field>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" size="lg" className="flex-1" onClick={() => copy('body')}>
                {copied === 'body' ? <><Check /> Copied</> : <><Copy /> Copy message</>}
              </Button>
              {wa && (
                <Button asChild variant="outline" size="lg" className="flex-1">
                  <a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /> Open in WhatsApp</a>
                </Button>
              )}
            </div>
            {msg.candidateEmail && <p className="text-xs text-muted-foreground">Send to: {msg.candidateEmail}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
