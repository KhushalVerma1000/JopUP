/**
 * Daily tracker email (HTML for clients + plain text), and the plain-text
 * block HR pastes into a group chat. All three render from the same frozen
 * snapshot rows, so what was emailed and what was copied cannot disagree.
 *
 * Everything that comes from the database goes through esc(): candidate names
 * and notes are user-typed text and this is HTML mail going to clients.
 */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const summaryLine = (s) => [
  `${s.active} in pipeline`,
  s.onHold ? `${s.onHold} on hold` : null,
  s.newToday ? `${s.newToday} new` : null,
  s.updatedToday ? `${s.updatedToday} updated` : null,
  s.joinedToday ? `${s.joinedToday} joined` : null,
  s.rejectedToday ? `${s.rejectedToday} rejected` : null,
].filter(Boolean).join(' · ');

function renderDailyTrackerEmail({ title, dateLabel, summary, columns, rows, senderName, orgName }) {
  const th = columns.map((c) => `<th align="left" style="padding:8px 10px;border-bottom:2px solid #d4d4d8;font-size:13px;color:#52525b;white-space:nowrap">${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => {
    const mark = r.change === 'new' ? ' <span style="color:#1d4ed8;font-size:11px">NEW</span>' : r.change === 'updated' ? ' <span style="color:#92400e;font-size:11px">UPDATED</span>' : '';
    const bg = r.change ? '#f4f8ff' : '#ffffff';
    const tds = columns.map((c, i) => `<td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;vertical-align:top">${esc(r[c.key])}${i === 0 ? mark : ''}</td>`).join('');
    return `<tr style="background:${bg}">${tds}</tr>`;
  }).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:760px;margin:0 auto;padding:20px">
<div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:10px;padding:20px">
<h2 style="margin:0 0 4px;font-size:18px;color:#18181b">${esc(title)}</h2>
<p style="margin:0 0 4px;color:#52525b;font-size:14px">${esc(dateLabel)}</p>
<p style="margin:0 0 16px;color:#52525b;font-size:14px">${esc(summaryLine(summary))}</p>
<div style="overflow-x:auto"><table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;min-width:560px"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>
<p style="margin:18px 0 0;color:#71717a;font-size:12px">Sent by ${esc(senderName)}${orgName ? `, ${esc(orgName)}` : ''} · This is a snapshot taken at send time.</p>
</div></div></body></html>`;
}

/** Plain text, grouped by position — the email's text part and the group-chat paste. */
function renderDailyTrackerText({ title, dateLabel, summary, rows }) {
  const lines = [`${title}`, dateLabel, summaryLine(summary), ''];
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.position)) groups.set(r.position, []);
    groups.get(r.position).push(r);
  }
  for (const [position, list] of groups) {
    lines.push(position);
    list.forEach((r, i) => {
      const bits = [r.name, r.number, r.location, r.stage, r.status, r.interview].filter(Boolean);
      lines.push(`${i + 1}. ${bits.join(' — ')}${r.change === 'new' ? ' (new)' : r.change === 'updated' ? ' (updated)' : ''}`);
    });
    lines.push('');
  }
  return lines.join('\n').trim();
}

module.exports = { renderDailyTrackerEmail, renderDailyTrackerText, summaryLine, esc };
