const { db, schema } = require('../../utils/db');
const { eq, and, or, isNull } = require('drizzle-orm');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
} = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const PUBLIC_USER_FIELDS = [
  'id', 'organisationId', 'email', 'firstName', 'lastName', 'phone',
  'avatarUrl', 'status', 'lastLoginAt', 'createdAt',
];

function toPublicUser(user) {
  const out = {};
  for (const field of PUBLIC_USER_FIELDS) out[field] = user[field];
  return out;
}

class AuthService {
  /**
   * Load a user's active team roles, shaped for the requireAuth JWT
   * payload / requirePermission checks: [{ teamId, roleName, permissions }]
   */
  async getActiveRoles(userId) {
    const rows = await db
      .select({
        teamId: schema.userTeamRole.teamId,
        roleName: schema.role.name,
        roleScope: schema.role.scope,
        permissions: schema.role.permissions,
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
      permissions: r.permissions,
    }));
  }

  /**
   * Self-registration for staff (HR / Manager only — org_admin and
   * platform_admin are invitation-only). Creates the user with status
   * 'pending_approval'; they cannot log in until a manager or org_admin
   * approves the request (see approveStaff/rejectStaff).
   */
  async registerStaff(data) {
    const org = await db.query.organisation.findFirst({
      where: eq(schema.organisation.id, data.organisationId),
    });
    if (!org) {
      throw new BadRequestError('Organisation not found');
    }

    const team = await db.query.team.findFirst({
      where: and(
        eq(schema.team.id, data.teamId),
        eq(schema.team.organisationId, data.organisationId)
      ),
    });
    if (!team) {
      throw new BadRequestError('Team not found in this organisation');
    }

    const role = await db.query.role.findFirst({
      where: eq(schema.role.name, data.requestedRoleName),
    });
    if (!role) {
      throw new BadRequestError(`Role '${data.requestedRoleName}' does not exist`);
    }

    if (data.requestedManagerId) {
      const managerIsValid = await this._isEligibleApprover(
        data.requestedManagerId,
        data.organisationId,
        data.teamId
      );
      if (!managerIsValid) {
        throw new BadRequestError(
          'requestedManagerId must be an active org_admin of this organisation, or an active manager of the chosen team'
        );
      }
    }

    const existing = await db.query.user.findFirst({
      where: and(
        eq(schema.user.email, data.email),
        eq(schema.user.organisationId, data.organisationId)
      ),
    });
    if (existing) {
      throw new ConflictError('A user with this email already exists in this organisation');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const [newUser] = await db
      .insert(schema.user)
      .values({
        organisationId: data.organisationId,
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
        status: 'pending_approval',
        requestedTeamId: data.teamId,
        requestedRoleId: role.id,
        requestedManagerId: data.requestedManagerId || null,
      })
      .returning();

    await auditWrite(
      data.organisationId,
      newUser.id,
      'create',
      'user',
      newUser.id,
      null,
      { email: newUser.email, status: newUser.status, requestedRoleName: data.requestedRoleName },
      'auth'
    );

    return toPublicUser(newUser);
  }

  /**
   * Returns true if `candidateUserId` is allowed to approve/reject
   * registration requests for `teamId` within `organisationId` —
   * i.e. an active org_admin of the org, or an active manager of the team.
   */
  async _isEligibleApprover(candidateUserId, organisationId, teamId) {
    const candidate = await db.query.user.findFirst({
      where: and(
        eq(schema.user.id, candidateUserId),
        eq(schema.user.organisationId, organisationId),
        eq(schema.user.status, 'active')
      ),
    });
    if (!candidate) return false;

    const roles = await this.getActiveRoles(candidateUserId);
    return roles.some(
      (r) =>
        (r.roleName === 'org_admin' && r.scope === 'org') ||
        (r.roleName === 'manager' && r.scope === 'team' && r.teamId === teamId)
    );
  }

  async login(organisationSlug, email, password) {
    const org = await db.query.organisation.findFirst({
      where: eq(schema.organisation.slug, organisationSlug),
    });
    // Deliberately generic error — don't reveal whether the org/email exists.
    if (!org) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const user = await db.query.user.findFirst({
      where: and(
        eq(schema.user.email, email),
        eq(schema.user.organisationId, org.id)
      ),
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError('Invalid credentials');
    }

    if (user.status === 'pending_approval') {
      throw new UnauthorizedError('Your registration is awaiting manager/admin approval');
    }
    if (user.status === 'rejected') {
      throw new UnauthorizedError('Your registration request was not approved');
    }
    if (user.status === 'suspended' || user.status === 'inactive') {
      throw new UnauthorizedError('This account is not active. Contact your organisation admin');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedError('Account is not active');
    }

    const roles = await this.getActiveRoles(user.id);

    const token = jwt.sign(
      {
        userId: user.id,
        organisationId: user.organisationId,
        email: user.email,
        roles: roles.map(({ teamId, roleName, permissions }) => ({ teamId, roleName, permissions })),
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    await db
      .update(schema.user)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.user.id, user.id));

    return { token, user: toPublicUser(user), roles };
  }
}

module.exports = new AuthService();
