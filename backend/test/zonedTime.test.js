const test = require('node:test');
const assert = require('node:assert/strict');
const { localDate, localDayBounds, isDue, addDays, assertTimeZone, localParts } = require('../src/utils/zonedTime');
const { outgoingStageLabel } = require('../src/utils/stageLabels');

test('local date follows the zone, not UTC', () => {
  const t = new Date('2026-10-03T20:00:00Z');            // 01:30 on the 4th in Kolkata
  assert.equal(localDate(t, 'UTC'), '2026-10-03');
  assert.equal(localDate(t, 'Asia/Kolkata'), '2026-10-04');
  assert.equal(localDate(t, 'America/Los_Angeles'), '2026-10-03');
});

test('a local day in a fixed-offset zone is exactly 24h and starts at the right instant', () => {
  const { start, end } = localDayBounds('2026-10-03', 'Asia/Kolkata');
  assert.equal(start.toISOString(), '2026-10-02T18:30:00.000Z');   // 00:00 IST
  assert.equal(end - start, 24 * 3600 * 1000);
});

test('DST days are 23 / 25 hours long (America/New_York, 2026)', () => {
  const spring = localDayBounds('2026-03-08', 'America/New_York');
  const autumn = localDayBounds('2026-11-01', 'America/New_York');
  assert.equal((spring.end - spring.start) / 3600000, 23);
  assert.equal((autumn.end - autumn.start) / 3600000, 25);
  assert.equal(spring.start.toISOString(), '2026-03-08T05:00:00.000Z');  // still EST at midnight
});

test('consecutive local days tile with no gap or overlap', () => {
  for (const tz of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe']) {
    let day = '2026-03-25';
    for (let i = 0; i < 12; i++) {
      const a = localDayBounds(day, tz), b = localDayBounds(addDays(day, 1), tz);
      assert.equal(a.end.getTime(), b.start.getTime(), `${tz} ${day}`);
      day = addDays(day, 1);
    }
  }
});

test('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('isDue: weekday and clock are both checked, in local time', () => {
  const sched = { sendTime: '18:00', sendDays: [1, 2, 3, 4, 5, 6] };
  // Sat 2026-10-03 12:29Z = 17:59 IST, 12:30Z = 18:00 IST
  assert.equal(isDue(new Date('2026-10-03T12:29:00Z'), sched, 'Asia/Kolkata'), false);
  assert.equal(isDue(new Date('2026-10-03T12:30:00Z'), sched, 'Asia/Kolkata'), true);
  // catch-up: still due hours later the same day
  assert.equal(isDue(new Date('2026-10-03T17:00:00Z'), sched, 'Asia/Kolkata'), true);
  // Sunday (7) is not a send day
  assert.equal(isDue(new Date('2026-10-04T12:30:00Z'), sched, 'Asia/Kolkata'), false);
  assert.equal(localParts(new Date('2026-10-04T12:30:00Z'), 'Asia/Kolkata').isoWeekday, 7);
});

test('assertTimeZone rejects junk', () => {
  assert.equal(assertTimeZone('Asia/Kolkata'), 'Asia/Kolkata');
  assert.throws(() => assertTimeZone('Mars/Olympus'), RangeError);
});

test('outgoing stage label: Turn up is called Reached, everything else is unchanged', () => {
  assert.equal(outgoingStageLabel('turnup', 'Turn up'), 'Reached');
  assert.equal(outgoingStageLabel('interview', 'Interview'), 'Interview');
  assert.equal(outgoingStageLabel(undefined, 'Custom stage'), 'Custom stage');
});
