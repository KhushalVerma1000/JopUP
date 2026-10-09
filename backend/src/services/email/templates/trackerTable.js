const { esc } = require('./lineup');

/**
 * A tracker as the client sees it: one bordered, Excel-style table. Built from
 * { columns: [{label}], rows: [[string]] } so the HTML, the plain-text copy and
 * the paste-into-Excel (TSV) copy are always the same cells.
 *
 * Inline styles only — mail clients strip <style> blocks. Every cell is
 * escaped: names, remarks and locations are typed by users and this goes out
 * to clients.
 */
function renderTrackerMail({ clientName, title, intro, columns, rows, senderName, orgName }) {
  const subject = title;
  const head = columns.map((c) => c.label);

  const cell = 'border:1px solid #bfbfbf;padding:6px 10px;font-size:13px;color:#18181b;vertical-align:top;white-space:nowrap';
  const th = 'border:1px solid #bfbfbf;padding:6px 10px;font-size:13px;font-weight:bold;background:#e7e6e6;color:#18181b;text-align:left;white-space:nowrap';
  const table = `<div style="overflow-x:auto"><table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #bfbfbf;font-family:Calibri,Arial,Helvetica,sans-serif"><thead><tr>${head.map((h) => `<th align="left" style="${th}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr${i % 2 ? ' style="background:#f7f7f7"' : ''}>${r.map((v) => `<td style="${cell}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  const greeting = clientName ? `Hi ${clientName} team,` : 'Hi,';
  const lead = intro || 'Please find the tracker below.';
  const html = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:14px;color:#18181b"><p>${esc(greeting)}</p><p>${esc(lead)}</p>${table}<p style="margin-top:20px">Regards,<br>${esc(senderName)}${orgName ? `<br>${esc(orgName)}` : ''}</p></div>`;

  // Plain text: columns padded so it still reads as a table in a monospace box.
  const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => clean(r[i]).length)));
  const line = (cells) => cells.map((v, i) => clean(v).padEnd(widths[i])).join(' | ').trimEnd();
  const text = [greeting, '', lead, '', line(head), widths.map((w) => '-'.repeat(w)).join('-+-'), ...rows.map(line), '', 'Regards,', senderName || '', orgName || ''].join('\n').replace(/\n+$/, '');

  // Tab-separated: pastes into Excel/Sheets as real cells.
  const tsv = [head, ...rows].map((r) => r.map(clean).join('\t')).join('\n');

  return { subject, text, html, tsv, whatsappText: '' };
}

module.exports = { renderTrackerMail };
