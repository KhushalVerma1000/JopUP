/**
 * In-process scheduler for daily trackers: wakes every minute, asks the service
 * what is due, sends it. No cron dependency and no queue — the run table's
 * unique index is what makes this safe if several app instances all tick.
 *
 * Off with DAILY_TRACKER_SCHEDULER=off (e.g. on web-only instances if you split
 * workers later). Never started by the test suite (only server.js starts it).
 */
const service = require('./daily-trackers.service');

const TICK_MS = 60 * 1000;
let timer = null;
let busy = false;

async function safeTick() {
  if (busy) return;                      // previous tick still sending: don't overlap
  busy = true;
  try { await service.tick(new Date()); }
  catch (err) { console.error(`[daily-tracker] tick failed: ${err.message}`); }
  finally { busy = false; }
}

function start() {
  if (timer || (process.env.DAILY_TRACKER_SCHEDULER || '').toLowerCase() === 'off') return false;
  timer = setInterval(safeTick, TICK_MS);
  timer.unref();                         // never keeps the process alive on its own
  setTimeout(safeTick, 5000).unref();    // catch up promptly after a restart
  console.log('   Daily tracker scheduler: on (checks every minute)');
  return true;
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick: safeTick };
