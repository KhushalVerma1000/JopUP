/**
 * Copy text to the clipboard.
 *
 * navigator.clipboard only exists in secure contexts (https or localhost) —
 * on a phone hitting the dev server over a LAN IP it is undefined — so fall
 * back to a hidden textarea + execCommand('copy'). Both paths must run
 * inside the user's tap, so callers should invoke this synchronously from
 * the click handler (before any await) and await the returned promise.
 */
export function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Run `work` (a promise, already started) and put `text` on the clipboard
 * only if it succeeds — so what HR pastes into the group chat is never a
 * stage update that didn't actually happen.
 *
 * That needs the browser to accept "the clipboard text will arrive later"
 * while we're still inside the tap: ClipboardItem takes a promise for its
 * contents. Where it isn't available (older browsers, plain-http dev server)
 * we copy immediately and the caller is told so (`copied` is true even when
 * `moved` is false) and can say "ignore the text just copied".
 *
 * Never rejects. Returns { moved, copied, error? }.
 */
export async function runAndCopy(work, text) {
  const settled = Promise.resolve(work).then(() => ({ ok: true }), (error) => ({ ok: false, error }));

  const canDefer = window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined';
  if (canDefer) {
    const blob = settled.then((r) => {
      if (!r.ok) throw r.error;
      return new Blob([text], { type: 'text/plain' });
    });
    let copied = true;
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]); } catch { copied = false; }
    const r = await settled;
    return r.ok ? { moved: true, copied } : { moved: false, copied: false, error: r.error };
  }

  // Must run before the first await: the tap's permission to copy ends with this tick.
  const copiedNow = copyText(text);
  const [copied, r] = await Promise.all([copiedNow, settled]);
  return r.ok ? { moved: true, copied } : { moved: false, copied, error: r.error };
}

// How a stage is NAMED in pasted updates. Recruiters tell the group a candidate
// has "Reached" when the workflow stage is "Turn up". Keyed by the stage's
// stable stageKey (names can be renamed per team); only the copied text
// changes — screens, API and database keep the real stage name.
// Mirror: backend/src/utils/stageLabels.js
const STAGE_LABEL_FOR_COPY = { turnup: 'Reached' };

export function copyStageLabel(stageKey, stageName) {
  return STAGE_LABEL_FOR_COPY[stageKey] || stageName;
}

/**
 * The block HR pastes into WhatsApp / the client thread when a candidate
 * moves stage. Missing values print as "-" so the shape stays identical
 * from message to message.
 */
export function buildUpdateText({ name, phone, location, position, stage, status }) {
  const lines = [
    `Name: ${name || '-'}`,
    `Mobile: ${phone || '-'}`,
    `Location: ${location || '-'}`,
    `Position: ${position || '-'}`,
  ];
  if (stage) lines.push(`Stage: ${stage}`);
  if (status) lines.push(`Status: ${status}`);
  return lines.join('\n');
}
