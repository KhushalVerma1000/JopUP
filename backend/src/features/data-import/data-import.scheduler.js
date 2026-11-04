/**
 * Hourly purge of expired import batches. Staged rows hold candidate personal
 * data, so they are not kept past their expiry. Off with DATA_IMPORT_SCHEDULER=off.
 * Never started by the test suite (only server.js starts it).
 */
const service = require('./data-import.service');

const TICK_MS = 60 * 60 * 1000;
let timer = null;
let busy = false;

async function safeTick() {
  if (busy) return;
  busy = true;
  try { const n = await service.purgeExpired(new Date()); if (n) console.log(`[data-import] purged ${n} expired import(s)`); }
  catch (err) { console.error(`[data-import] purge failed: ${err.message}`); }
  finally { busy = false; }
}

function start() {
  if (timer || (process.env.DATA_IMPORT_SCHEDULER || '').toLowerCase() === 'off') return false;
  timer = setInterval(safeTick, TICK_MS);
  timer.unref();
  setTimeout(safeTick, 30_000).unref();
  console.log('   Import cleanup: on (hourly)');
  return true;
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick: safeTick };
