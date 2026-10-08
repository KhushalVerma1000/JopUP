// Lineup-date helpers. "Day" always means the HR's own local calendar day.

export function dayKey(input) {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return dayKey(d);
}

/** 'any' | 'today' | 'tomorrow' | 'YYYY-MM-DD'  →  'YYYY-MM-DD' or '' for any day. */
export function resolveDay(choice) {
  if (!choice || choice === 'any') return '';
  if (choice === 'today') return todayKey(0);
  if (choice === 'tomorrow') return todayKey(1);
  return choice;
}

/** Date + optional "HH:MM" typed locally → ISO. No time = local midnight (the server reads that as "no time set"). */
export function toIso(day, time) {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).toISOString();
}

export function timeKey(input) {
  if (!input) return '';
  const d = new Date(input);
  const p = (n) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return hm === '00:00' ? '' : hm;
}

export function lineupLabel(input) {
  if (!input) return '';
  const d = new Date(input);
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const t = timeKey(input);
  return t ? `${day}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}` : day;
}
