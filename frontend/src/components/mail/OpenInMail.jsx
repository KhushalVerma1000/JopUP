import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { PROVIDERS } from '../../lib/composeLinks';

const pasteKey = () => (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘V' : 'Ctrl+V');

/** The "Open in Gmail / Outlook" button and its provider picker. `m` is the useTrackerMail result. */
export function OpenInMailButton({ m, disabled, size = 'lg', className }) {
  return (
    <Button type="button" size={size} className={className} disabled={disabled} onClick={m.openInMail}>
      <ExternalLink /> Open in {PROVIDERS[m.provider].short}
    </Button>
  );
}

export function ProviderSelect({ m, className }) {
  return (
    <NativeSelect aria-label="Open mail with" className={className} value={m.provider} onChange={(e) => m.setProvider(e.target.value)}>
      {Object.entries(PROVIDERS).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}
    </NativeSelect>
  );
}

/** What happened after the click, and what to do next. Renders nothing before the first click. */
export function OpenedNote({ m, className }) {
  const o = m.opened;
  if (!o) return null;
  return (
    <div role="status" className={className}>
      {o.copied
        ? <p className="text-[13px] text-emerald-700">✓ Table copied. Paste it into the email ({pasteKey()}).</p>
        : <p className="text-[13px] text-amber-700">Your browser blocked copying. Tap Copy Table, then paste it into the email.</p>}
      {o.blocked && (
        <p className="mt-1 text-[13px]">
          Your browser blocked the new window. <a href={o.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">Open the email</a>
        </p>
      )}
      {o.truncated && <p className="mt-1 text-xs text-muted-foreground">The greeting was shortened to fit the link. Edit it in the email.</p>}
      <p className="mt-1 text-xs text-muted-foreground">Attachments are not added automatically. After you send, tap Mark as Sent.</p>
    </div>
  );
}
