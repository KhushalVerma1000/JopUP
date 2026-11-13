import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToday, dayOffset, daysBetween, whatsappText, QUIET_DAYS, QUIET_LIST_MAX } from './today.js';

// Friday 13 Nov 2026, 09:00 on the HR's own clock.
const NOW = new Date(2026, 10, 13, 9, 0, 0);
const at = (dayDelta, h = 0, m = 0) => new Date(2026, 10, 13 + dayDelta, h, m, 0).toISOString();
let n = 0;
const t = (over = {}) => ({
  id: `t${++n}`, status: 'active', candidateName: 'Rahul Sharma', openPositionDesignation: 'Sales executive',
  currentStage: { stageKey: 'lineup', name: 'Line-up', isFinalSuccess: false },
  currentStageEnteredAt: at(-1), lineupDate: null, interviewDate: null,
  rescheduleCount: 0, notComingAt: null, confirmedFor: null, ...over,
});
const ids = (list) => list.map((i) => i.tracker.id);

test('dayOffset and daysBetween work on calendar days, not hours', () => {
  assert.equal(dayOffset(NOW, 0), '2026-11-13');
  assert.equal(dayOffset(NOW, 1), '2026-11-14');
  assert.equal(dayOffset(NOW, -13), '2026-10-31');
  assert.equal(daysBetween('2026-11-11', '2026-11-13'), 2);
  assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1);
});

test('lineup today, tomorrow and a missed lineup land in their own sections', () => {
  const a = t({ lineupDate: at(0, 10, 30) });
  const b = t({ lineupDate: at(1, 11) });
  const c = t({ lineupDate: at(-2, 10) });
  const r = buildToday([a, b, c], NOW);
  assert.deepEqual(ids(r.today), [a.id]);
  assert.deepEqual(ids(r.tomorrow), [b.id]);
  assert.deepEqual(ids(r.late), [c.id]);
  assert.equal(r.late[0].daysLate, 2);
  assert.equal(r.late[0].field, 'lineupDate');
});

test('a date with no time still counts for its day', () => {
  const r = buildToday([t({ lineupDate: at(0) })], NOW);
  assert.equal(r.today.length, 1);
});

test('a date further ahead is not listed, and keeps the candidate out of Quiet', () => {
  const a = t({ lineupDate: at(4, 10), currentStageEnteredAt: at(-9) });
  const r = buildToday([a], NOW);
  assert.equal(r.today.length + r.tomorrow.length + r.late.length + r.quiet.length, 0);
});

test('once reached, the old lineup date no longer raises an alarm', () => {
  const a = t({ lineupDate: at(-2), currentStage: { stageKey: 'turnup', name: 'Turn up' } });
  assert.equal(buildToday([a], NOW).late.length, 0);
});

test('an interview date stays open through Turn up and Interview, and closes at Offer', () => {
  const inTurnup = t({ interviewDate: at(0, 15), currentStage: { stageKey: 'turnup', name: 'Turn up' } });
  const inOffer = t({ interviewDate: at(0, 15), currentStage: { stageKey: 'offer', name: 'Offer' } });
  const r = buildToday([inTurnup, inOffer], NOW);
  assert.deepEqual(ids(r.today), [inTurnup.id]);
  assert.equal(r.today[0].kind, 'interview');
  assert.equal(r.today[0].field, 'interviewDate');
});

test('unknown custom stages never raise a late alarm', () => {
  const a = t({ lineupDate: at(-3), currentStage: { stageKey: 'client_round', name: 'Client round' } });
  assert.equal(buildToday([a], NOW).late.length, 0);
});

test('closed and held candidates are ignored', () => {
  const list = ['rejected', 'withdrawn', 'placed', 'on_hold'].map((status) => t({ status, lineupDate: at(0) }));
  const r = buildToday(list, NOW);
  assert.equal(r.today.length, 0);
});

test('a candidate appears once: missed beats today beats tomorrow', () => {
  const a = t({ lineupDate: at(-1), interviewDate: at(0, 12) });
  const r = buildToday([a], NOW);
  assert.equal(r.late.length, 1);
  assert.equal(r.today.length, 0);
  assert.equal(r.late[0].kind, 'lineup');
});

test('same-day lineup and interview: shown as what the candidate is at', () => {
  const atLineup = t({ lineupDate: at(0, 10), interviewDate: at(0, 11) });
  const atTurnup = t({ lineupDate: at(0, 10), interviewDate: at(0, 11), currentStage: { stageKey: 'turnup', name: 'Turn up' } });
  const r = buildToday([atLineup, atTurnup], NOW);
  assert.equal(r.today.find((i) => i.tracker.id === atLineup.id).kind, 'lineup');
  assert.equal(r.today.find((i) => i.tracker.id === atTurnup.id).kind, 'interview');
});

test('"not coming" on or after the missed day clears it from Needs update, but a later missed day does not', () => {
  const answered = t({ lineupDate: at(-2), notComingAt: at(-1, 18) });
  const answeredSameDay = t({ lineupDate: at(-2, 10), notComingAt: at(-2, 19) });
  const answeredBefore = t({ lineupDate: at(-1), notComingAt: at(-3) });
  const r = buildToday([answered, answeredSameDay, answeredBefore], NOW);
  assert.deepEqual(ids(r.late), [answeredBefore.id]);
});

test('rescheduling moves the candidate out of Needs update because the date changes', () => {
  const moved = t({ lineupDate: at(3, 10), rescheduleCount: 1 });
  const r = buildToday([moved], NOW);
  assert.equal(r.late.length, 0);
});

test('tomorrow shows who has already confirmed for that day only', () => {
  const yes = t({ lineupDate: at(1, 10), confirmedFor: dayOffset(NOW, 1) });
  const stale = t({ lineupDate: at(1, 10), confirmedFor: dayOffset(NOW, -4) });
  const r = buildToday([yes, stale], NOW);
  assert.equal(r.tomorrow.find((i) => i.tracker.id === yes.id).confirmed, true);
  assert.equal(r.tomorrow.find((i) => i.tracker.id === stale.id).confirmed, false);
});

test('today marks a candidate already answered "not coming" instead of dropping them', () => {
  const a = t({ lineupDate: at(0, 10), notComingAt: at(0, 8) });
  const r = buildToday([a], NOW);
  assert.equal(r.today.length, 1);
  assert.equal(r.today[0].handled, true);
});

test('sorting: most overdue first; timed rows by time; untimed rows last', () => {
  const x = t({ candidateName: 'X', lineupDate: at(-1) });
  const y = t({ candidateName: 'Y', lineupDate: at(-4) });
  const noTime = t({ candidateName: 'N', lineupDate: at(0) });
  const late = t({ candidateName: 'L', lineupDate: at(0, 14, 0) });
  const early = t({ candidateName: 'E', lineupDate: at(0, 9, 30) });
  const r = buildToday([x, y, noTime, late, early], NOW);
  assert.deepEqual(r.late.map((i) => i.tracker.candidateName), ['Y', 'X']);
  assert.deepEqual(r.today.map((i) => i.tracker.candidateName), ['E', 'L', 'N']);
});

test('quiet: only after QUIET_DAYS with nothing dated; final-stage candidates are left alone', () => {
  const fresh = t({ currentStageEnteredAt: at(-(QUIET_DAYS - 1)) });
  const stuck = t({ currentStageEnteredAt: at(-QUIET_DAYS), currentStage: { stageKey: 'offer', name: 'Offer' } });
  const done = t({ currentStageEnteredAt: at(-30), currentStage: { stageKey: 'joined', name: 'Joined', isFinalSuccess: true } });
  const r = buildToday([fresh, stuck, done], NOW);
  assert.deepEqual(ids(r.quiet), [stuck.id]);
  assert.equal(r.quiet[0].idleDays, QUIET_DAYS);
});

test('quiet list is capped but the real total is reported', () => {
  const many = Array.from({ length: QUIET_LIST_MAX + 4 }, () => t({ currentStageEnteredAt: at(-8) }));
  const r = buildToday(many, NOW);
  assert.equal(r.quiet.length, QUIET_LIST_MAX);
  assert.equal(r.quietTotal, QUIET_LIST_MAX + 4);
});

test('a candidate whose miss was answered can show up under Quiet once they go still', () => {
  const a = t({ lineupDate: at(-6), notComingAt: at(-6, 18), currentStageEnteredAt: at(-9) });
  const r = buildToday([a], NOW);
  assert.equal(r.late.length, 0);
  assert.deepEqual(ids(r.quiet), [a.id]);
});

test('whatsapp text: first name only, role named, client left out', () => {
  const item = { tracker: t({ clientName: 'HDFC', candidateName: 'Neha Singh' }), bucket: 'tomorrow', kind: 'lineup', date: at(1, 10, 30) };
  const msg = whatsappText(item, NOW);
  assert.match(msg, /^Hi Neha,/);
  assert.match(msg, /line-up tomorrow/);
  assert.match(msg, /Sales executive/);
  assert.doesNotMatch(msg, /HDFC/);
  assert.match(whatsappText({ tracker: t(), bucket: 'late', kind: 'interview', date: at(-1) }), /interview/);
  assert.match(whatsappText({ tracker: t({ candidateName: '' }) }), /^Hi there,/);
});
