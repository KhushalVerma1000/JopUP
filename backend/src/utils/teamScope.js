/**
 * Team scoping, derived from the roles in the caller's JWT
 * ({ teamId, roleName, permissions } per role — see requireAuth.js).
 *
 * Tenancy (organisation) is enforced everywhere already; this is the layer
 * *inside* a tenant. Before it existed, any HR could read every team's
 * candidates' names and phone numbers by calling the API directly — the UI
 * hid other teams, the server did not.
 *
 *   org_admin with no team  → sees every team in the org  (returns null)
 *   anyone else             → only the teams they hold a role in
 */
function visibleTeamIds(user) {
  const roles = user?.roles || [];
  if (roles.some((r) => r.roleName === 'org_admin' && !r.teamId)) return null;
  return [...new Set(roles.filter((r) => r.teamId).map((r) => r.teamId))];
}

function canSeeTeam(user, teamId) {
  const ids = visibleTeamIds(user);
  return ids === null || ids.includes(teamId);
}

module.exports = { visibleTeamIds, canSeeTeam };
