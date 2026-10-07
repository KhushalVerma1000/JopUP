/**
 * In-process job that keeps automatic KPIs, metric goals and strategies up to
 * date: wakes hourly and syncs every org that has anything automatic. Closed
 * KPI periods are locked, finished goals and strategies are frozen.
 *
 * Safe if several app instances all run it: every write is an idempotent upsert
 * guarded by an advisory lock. Reads also refresh stale numbers on demand, so
 * this job is the backstop, not the only thing keeping numbers current.
 *
 * Off with PERFORMANCE_SCHEDULER=off. Never started by the test suite (only server.js starts it).
 */
const metrics = require('./metrics.service');

const TICK_MS = Math.max(1, Number(process.env.PERFORMANCE_SYNC_MINUTES) || 60) * 60 * 1000;
let timer = null;
let busy = false;

async function safeTick() {
  if (busy) return;
  busy = true;
  try { await metrics.syncAll(new Date()); }
  catch (err) { console.error(`[performance-sync] tick failed: ${err.message}`); }
  finally { busy = false; }
}

function start() {
  if (timer || (process.env.PERFORMANCE_SCHEDULER || '').toLowerCase() === 'off') return false;
  timer = setInterval(safeTick, TICK_MS);
  timer.unref();
  setTimeout(safeTick, 10_000).unref();   // catch up after a restart
  console.log(`   Performance sync: on (every ${TICK_MS / 60000} min)`);
  return true;
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick: safeTick };
