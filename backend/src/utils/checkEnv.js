/**
 * Fail-fast checks for configuration that is harmless to leave unset in
 * development but breaks real users in production.
 *
 * APP_URL is the frontend base URL used to build links in emails (the
 * invitation "Accept invitation" button). Unset, it silently falls back to
 * http://localhost:5173 — so every emailed link would point at the
 * recipient's own machine.
 *
 * Returns a list of problems (empty = fine); assertProductionEnv() throws.
 */
function envProblems(env = process.env) {
  const problems = [];
  if (env.NODE_ENV !== 'production') return problems;

  const appUrl = (env.APP_URL || '').trim();
  if (!appUrl) {
    problems.push('APP_URL is not set — invitation emails would link to http://localhost:5173.');
  } else if (!/^https?:\/\//i.test(appUrl)) {
    problems.push(`APP_URL must start with http:// or https:// (got "${appUrl}").`);
  } else if (/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(appUrl)) {
    problems.push(`APP_URL points at ${appUrl}, which is not reachable by invitees.`);
  }
  return problems;
}

function assertProductionEnv(env = process.env) {
  const problems = envProblems(env);
  if (problems.length) {
    throw new Error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
  }
}

module.exports = { envProblems, assertProductionEnv };
