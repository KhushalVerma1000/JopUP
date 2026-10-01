// One place that decides "which role sees what, and where do they land".
// Roles arrive from the API as { teamId, roleName, permissions } (JWT shape).

export const has = (roles, name) => (roles || []).some((r) => r.roleName === name);

export function summariseRoles(roles) {
  const isPlatformOwner = has(roles, 'platform_owner');
  const isPlatformAdmin = has(roles, 'platform_admin');
  return {
    isPlatformOwner,
    isPlatformAdmin,
    isPlatform: isPlatformOwner || isPlatformAdmin,
    isOrgAdmin: (roles || []).some((r) => r.roleName === 'org_admin' && (r.teamId === null || r.teamId === undefined)),
    isManager: has(roles, 'manager'),
    isHr: has(roles, 'hr'),
    managedTeamIds: (roles || []).filter((r) => r.roleName === 'manager' && r.teamId).map((r) => r.teamId),
    hrTeamIds: (roles || []).filter((r) => r.roleName === 'hr' && r.teamId).map((r) => r.teamId),
  };
}

/** Where someone lands after sign-in / when they hit "/". Highest role wins. */
export function homePathFor(s) {
  if (s.isPlatform) return '/platform';
  if (s.isOrgAdmin) return '/dashboard';
  if (s.isManager) return '/manager';
  if (s.isHr) return '/hr';
  return '/dashboard';
}

export const ROLE_LABELS = {
  platform_owner: 'Platform owner',
  platform_admin: 'Platform admin',
  org_admin: 'Org admin',
  manager: 'Manager',
  hr: 'HR',
};

export function primaryRoleLabel(s) {
  if (s.isPlatformOwner) return ROLE_LABELS.platform_owner;
  if (s.isPlatformAdmin) return ROLE_LABELS.platform_admin;
  if (s.isOrgAdmin) return ROLE_LABELS.org_admin;
  if (s.isManager) return ROLE_LABELS.manager;
  if (s.isHr) return ROLE_LABELS.hr;
  return 'No role';
}

/** Does any of the caller's roles grant entity:action? (mirrors backend requirePermission) */
export const can = (roles, entity, action) =>
  (roles || []).some((r) => r.permissions?.[entity]?.includes(action));
