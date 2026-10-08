/**
 * Day-to-day HR mail templates, rendered as plain text (what HR copies), HTML
 * (for when a provider is attached) and a short WhatsApp message. All three
 * come from the same rows so they cannot disagree.
 *
 * Phase 1 is copy-only: nothing here sends anything.
 *
 * Candidate names, notes and locations are typed by users and this goes to
 * clients, so every value that lands in HTML goes through esc().
 */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeTz(tz) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

/** "Tue, 14 Oct 2026" in the org's timezone. */
function formatDay(date, tz) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: safeTz(tz) }).format(new Date(date));
}

/** "3:30 pm" — empty when the date is exactly local midnight (no time was chosen). */
function formatTime(date, tz) {
  if (!date) return '';
  const z = safeTz(tz);
  const d = new Date(date);
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: z }).format(d);
  if (hm === '00:00') return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: z }).format(d).toLowerCase();
}

function groupByPosition(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.position || 'Position not specified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()];
}

/** Lineup mail to a client: who is coming on a given day, grouped by position. */
function renderLineupMail({ clientName, dateLabel, rows, senderName, orgName }) {
  const subject = `Lineup for ${dateLabel}${clientName ? ` — ${clientName}` : ''}`;
  const groups = groupByPosition(rows);

  const text = [
    clientName ? `Hi ${clientName} team,` : 'Hi,',
    '',
    `Please find the candidates lined up for ${dateLabel}.`,
    '',
  ];
  for (const [position, list] of groups) {
    text.push(position);
    list.forEach((r, i) => {
      text.push(`${i + 1}. ${[r.name, r.phone, r.location, r.time].filter(Boolean).join(' | ')}`);
    });
    text.push('');
  }
  text.push('Regards,', senderName || '');
  if (orgName) text.push(orgName);

  const th = ['Name', 'Mobile', 'Location', 'Time'].map((h) => `<th align="left" style="padding:8px 10px;border-bottom:2px solid #d4d4d8;font-size:13px;color:#52525b">${h}</th>`).join('');
  const td = 'padding:8px 10px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;vertical-align:top';
  const sections = groups.map(([position, list]) => `<h3 style="margin:18px 0 6px;font-size:15px;color:#18181b">${esc(position)}</h3>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%"><thead><tr>${th}</tr></thead><tbody>${list.map((r) => `<tr><td style="${td}">${esc(r.name)}</td><td style="${td}">${esc(r.phone)}</td><td style="${td}">${esc(r.location)}</td><td style="${td}">${esc(r.time)}</td></tr>`).join('')}</tbody></table>`).join('');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;color:#18181b">
<p style="font-size:14px">${clientName ? `Hi ${esc(clientName)} team,` : 'Hi,'}</p>
<p style="font-size:14px">Please find the candidates lined up for ${esc(dateLabel)}.</p>${sections}
<p style="font-size:14px;margin-top:20px">Regards,<br>${esc(senderName)}${orgName ? `<br>${esc(orgName)}` : ''}</p></div>`;

  // Same list as a chat message — short enough to read on a phone.
  const wa = [`*Lineup for ${dateLabel}*${clientName ? ` — ${clientName}` : ''}`, ''];
  for (const [position, list] of groups) {
    wa.push(`*${position}*`);
    list.forEach((r, i) => wa.push(`${i + 1}. ${[r.name, r.phone, r.location, r.time].filter(Boolean).join(' | ')}`));
    wa.push('');
  }

  return { subject, text: text.join('\n'), html, whatsappText: wa.join('\n').trim() };
}

/** Reminder to one candidate about their interview. */
function renderInterviewReminder({ candidateName, position, clientName, dayLabel, time, location, senderName, orgName }) {
  const first = (candidateName || '').split(' ')[0] || 'there';
  const at = [position, clientName].filter(Boolean).join(' at ');
  const when = [dayLabel, time].filter(Boolean).join(', ');
  const subject = `Interview reminder${at ? ` — ${at}` : ''}${dayLabel ? `, ${dayLabel}` : ''}`;
  const lines = [
    `Hi ${first},`,
    '',
    `This is a reminder about your interview${at ? ` for ${at}` : ''}${when ? ` on ${when}` : ''}.`,
  ];
  if (location) lines.push(`Location: ${location}`);
  lines.push('', 'Please confirm that you will be able to attend, and let me know if anything changes.', '', 'Regards,', senderName || '');
  if (orgName) lines.push(orgName);
  const text = lines.join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;font-size:14px;color:#18181b">${lines.map((l) => (l === '' ? '<br>' : `<div>${esc(l)}</div>`)).join('')}</div>`;
  const whatsappText = [`Hi ${first}, a reminder about your interview${at ? ` for ${at}` : ''}${when ? ` on ${when}` : ''}.`, location ? `Location: ${location}` : null, 'Please confirm you can attend.'].filter(Boolean).join('\n');
  return { subject, text, html, whatsappText };
}

module.exports = { renderLineupMail, renderInterviewReminder, formatDay, formatTime, groupByPosition, esc };
