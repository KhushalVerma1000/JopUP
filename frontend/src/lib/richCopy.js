import { copyText } from './clipboard';

/**
 * Copy a formatted table so it pastes as a real table into Outlook/Gmail/Word,
 * and as plain text anywhere that only takes text. Falls back to plain text
 * when the browser can't write HTML to the clipboard (older browsers, http).
 * Call from the click handler, before any await.
 */
export function copyRich(html, text) {
  if (window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    });
    return navigator.clipboard.write([item]).then(() => true, () => copyText(text));
  }
  return copyText(text);
}
