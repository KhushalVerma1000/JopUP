const { db, schema } = require('../../utils/db');
const { eq, and, isNull, inArray } = require('drizzle-orm');
const bcrypt = require('bcryptjs');
const { BadRequestError, NotFoundError, ConflictError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');

const PLATFORM_ROLE_NAMES = ['platform_owner', 'platform_admin'];

const PUBLIC_FIELDS = ['id', 'organisationId', 'email', 'firstName', 'lastName', 'status', 'lastLoginAt', 'createdAt'];
function toPublicUser(u) {
  const out = {};
  for (const f of PUBLIC_FIELDS) out[f] = u[f];
  return out;
}

class PlatformAdminsService {
  /**
   * List everyone currently holding a platform-scope role (owner + admins),
   * regardless of which internal platform organisation they happen to be
   * attached to (see provision-owner.ts's design note — organisationId is a
   * schema requirement, not a meaningful tenant boundary for these accounts).
   */
  async list() {
    const roles = await db
      .select({ id: schema.role.id, name: schema.role.name })
      .from(schema.role)
      .where(inArray(schema.role.name, PLATFORM_ROLE_NAMES));
    const roleIdToName = Object.fromEntries(roles.map((r) => [r.id, r.name]));
    const roleIds = roles.map((r) => r.id);
    if (roleIds.length === 0) return [];

    const rows = await db
      .select({
        user: schema.user,
        roleId: schema.userTeamRole.roleId,
      })
      .from(schema.userTeamRole)
      .innerJoin(schema.user, eq(schema.userTeamRole.userId, schema.user.id))
      .where(
        and(
          inArray(schema.userTeamRole.roleId, roleIds),
          isNull(schema.userTeamRole.revokedAt)
        )
      );

    return rows.map((r) => ({
      ...toPublicUser(r.user),
      role: roleIdToName[r.roleId],
    }));
  }

  /**
   * Owner creates a new platform_admin sub-admin. Always role='platform_admin' —
   * this route can never mint another platform_owner (see provision-owner.ts).
   * Created directly active (no self-registration/approval/invitation step):
   * the owner typing the account into existence *is* the vetting.
   */
  async create(organisationId, ownerUserId, data) {
    const adminRole = await db.query.role.findFirst({
      where: eq(schema.role.name, 'platform_admin'),
    });
    if (!adminRole) {
      throw new BadRequestError("Role 'platform_admin' not found — has the DB been seeded?");
    }

    const existing = await db.query.user.findFirst({
      where: and(
        eq(schema.user.email, data.email),
        eq(schema.user.organisationId, organisationId)
      ),
    });
    if (existing) {
      throw new ConflictError('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const [newAdmin] = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(schema.user)
        .values({
          organisationId,
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          status: 'active',
        })
        .returning();

      await tx.insert(schema.userTeamRole).values({
        userId: u.id,
        teamId: null,
        roleId: adminRole.id,
        assignedBy: ownerUserId,
      });

      return [u];
    });

    await auditWrite(organisationId, ownerUserId, 'create', 'user', newAdmin.id, null, { email: newAdmin.email, role: 'platform_admin' }, 'platform_admins');

    return { ...toPublicUser(newAdmin), role: 'platform_admin' };
  }

  /**
   * Owner removes a platform_admin sub-admin: revokes the role assignment
   * (revokedAt, not a hard delete — audit trail stays intact) and suspends
   * the account so they can no longer log in at all.
   */
  async remove(organisationId, ownerUserId, targetUserId) {
    if (targetUserId === ownerUserId) {
      throw new BadRequestError('You cannot remove your own admin access via this route');
    }

    const target = await db.query.user.findFirst({
      where: and(
        eq(schema.user.id, targetUserId),
        eq(schema.user.organisationId, organisationId)
      ),
    });
    if (!target) throw new NotFoundError('Admin user not found');

    const assignment = await db
      .select({ id: schema.userTeamRole.id, roleName: schema.role.name })
      .from(schema.userTeamRole)
      .innerJoin(schema.role, eq(schema.userTeamRole.roleId, schema.role.id))
      .where(
        and(
          eq(schema.userTeamRole.userId, targetUserId),
          inArray(schema.role.name, PLATFORM_ROLE_NAMES),
          isNull(schema.userTeamRole.revokedAt)
        )
      )
      .limit(1);

    if (assignment.length === 0) {
      throw new NotFoundError('This user does not hold an active platform-level role');
    }
    if (assignment[0].roleName === 'platform_owner') {
      // Owners can only be provisioned/removed out-of-band (provision-owner.ts) —
      // deliberately no HTTP route can touch that tier, to keep it as the one
      // account that can't be locked out or removed by another admin.
      throw new BadRequestError('Cannot remove a platform_owner via this route');
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.userTeamRole)
        .set({ revokedAt: new Date() })
        .where(eq(schema.userTeamRole.id, assignment[0].id));

      await tx
        .update(schema.user)
        .set({ status: 'suspended' })
        .where(eq(schema.user.id, targetUserId));
    });

    await auditWrite(organisationId, ownerUserId, 'update', 'user', targetUserId, { status: target.status }, { status: 'suspended', roleRevoked: 'platform_admin' }, 'platform_admins');

    return { id: targetUserId, status: 'suspended' };
  }
}

module.exports = new PlatformAdminsService();
