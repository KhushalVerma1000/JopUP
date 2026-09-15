const { db, schema } = require('../../utils/db');
const { eq, and, isNull } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');

const PUBLIC_USER_FIELDS = [
  'id', 'organisationId', 'email', 'firstName', 'lastName', 'phone',
  'avatarUrl', 'status', 'lastLoginAt', 'createdAt',
];

function toPublicUser(user) {
  const out = {};
  for (const field of PUBLIC_USER_FIELDS) out[field] = user[field];
  return out;
}

class UsersService {
  /**
   * Same shape/query as AuthService.getActiveRoles. Duplicated rather than
   * imported to avoid a circular dependency between the auth and users
   * features — both are small enough that this is cheaper than a shared
   * "roles" module for now.
   */
  async getActiveRoles(userId) {
    const rows = await db
      .select({
        teamId: schema.userTeamRole.teamId,
        roleName: schema.role.name,
        roleScope: schema.role.scope,
      })
      .from(schema.userTeamRole)
      .innerJoin(schema.role, eq(schema.userTeamRole.roleId, schema.role.id))
      .where(
        and(
          eq(schema.userTeamRole.userId, userId),
          isNull(schema.userTeamRole.revokedAt)
        )
      );

    return rows.map((r) => ({
      teamId: r.teamId || null,
      roleName: r.roleName,
      scope: r.roleScope,
    }));
  }

  /**
   * Employee directory. Open to any authenticated staff member of the org
   * (same precedent as teams.routes.js's plain GET) — for internal beta
   * testing, colleagues seeing each other's names/roles/status isn't
   * sensitive, and every workbench (employee, client, manager) needs this
   * to populate "assigned to" / "owner" pickers.
   */
  async listUsers(orgId, { teamId, status } = {}) {
    const conditions = [eq(schema.user.organisationId, orgId)];
    if (status) conditions.push(eq(schema.user.status, status));

    const rows = await db.select().from(schema.user).where(and(...conditions));

    const withRoles = await Promise.all(
      rows.map(async (u) => ({ ...toPublicUser(u), roles: await this.getActiveRoles(u.id) }))
    );

    if (!teamId) return withRoles;
    return withRoles.filter((u) => u.roles.some((r) => r.teamId === teamId));
  }

  async getUserById(orgId, id) {
    const u = await db.query.user.findFirst({
      where: and(eq(schema.user.id, id), eq(schema.user.organisationId, orgId)),
    });
    if (!u) {
      throw new NotFoundError('User not found');
    }
    const roles = await this.getActiveRoles(id);
    return { ...toPublicUser(u), roles };
  }

  async updateProfile(orgId, id, data, actorId) {
    const before = await this.getUserById(orgId, id);

    const [updated] = await db
      .update(schema.user)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.user.id, id), eq(schema.user.organisationId, orgId)))
      .returning();

    if (!updated) {
      throw new NotFoundError('User not found');
    }

    await auditWrite(orgId, actorId, 'update', 'user', id, before, toPublicUser(updated), 'users');
    return toPublicUser(updated);
  }

  /**
   * Deliberately a status flip, never a hard delete — user rows are
   * referenced from audit_log, approvals, invitations, assignments, etc.
   * across the schema, so removing the row would either cascade-delete
   * history or fail on FK constraints. 'inactive'/'suspended' is also what
   * the login flow already checks for (auth.service.js), so this is
   * immediately effective.
   */
  async updateStatus(orgId, id, status, actorId) {
    const before = await this.getUserById(orgId, id);

    if (id === actorId && status !== 'active') {
      throw new BadRequestError('You cannot deactivate or suspend your own account');
    }

    const [updated] = await db
      .update(schema.user)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.user.id, id), eq(schema.user.organisationId, orgId)))
      .returning();

    if (!updated) {
      throw new NotFoundError('User not found');
    }

    await auditWrite(orgId, actorId, 'update', 'user', id, { status: before.status }, { status }, 'users');
    return toPublicUser(updated);
  }
}

module.exports = new UsersService();
