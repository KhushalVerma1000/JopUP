/**
 * A log-friendly error. Drizzle wraps database failures as "Failed query: <sql> params: …" and keeps the real reason
 * (connection refused, timeout, missing column…) in `cause`, so logging only err.message hides the one thing you need.
 * Returns the message, shortened to its first line, followed by each cause.
 */
function describeError(err) {
  const parts = []; const seen = new Set();
  for (let e = err; e && !seen.has(e) && parts.length < 4; e = e.cause) {
    seen.add(e);
    const msg = String((e && e.message) || e).split('\n')[0].slice(0, 300);
    const code = e && e.code ? ` [${e.code}]` : '';
    parts.push(`${msg}${code}`);
  }
  return parts.join(' ← caused by: ');
}

module.exports = { describeError };
