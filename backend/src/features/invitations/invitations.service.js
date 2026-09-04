const crypto = require('crypto');
const { db, schema } = require('../../utils/db');
const { eq, and } = require('drizzle-orm');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { BadRequestError, NotFoundError, ConflictError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');
const authService = require('../auth/auth.service'); // reuse getActiveRoles for the auto-login-on-accept JWT

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const INVITATION_TTL_DAYS = 7;

class InvitationsService {
  /**
   * org_admin sends an invitation. This is the only path to the org_admin
   * role — self-registration (auth.service.js) is capped to hr/manager.
   *
   * NOTE: there's no email delivery integration in this codebase yet, so the
   * raw token is returned in the response for now — whoever calls this route
   * is responsible for getting it to the invitee out-of-band until that
   * exists. Flagging honestly rather than pretending an email went out.
   */
  async create(organisationId, invitedByUserId, { email, roleName, teamId }) {
    // Validate the roleName/teamId relationship before touching the DB at
    // all — cheap checks should fail fast rather than surface as a 500 if
    // the DB happens to be unreachable.
    if (roleName === 'org_admin') {
      if (teamId) throw new BadRequestError('org_admin invitations must not specify a teamId (org-scoped, not team-scoped)');
    } else {
      if (!teamId) throw new BadRequestError(`teamId is required when inviting a ${roleName}`);
    }

    const role = await db.query.role.findFirst({ where: eq(schema.role.name, roleName) });
    if (!role) throw new BadRequestError(`Role '${roleName}' does not exist`);

    if (roleName !== 'org_admin') {
      const team = await db.query.team.findFirst({
        where: and(eq(schema.team.id, teamId), eq(schema.team.organisationId, organisationId)),
      });
      if (!team) throw new BadRequestError('Team not found in this organisation');
    }

    const existingUser = await db.query.user.findFirst({
      where: and(eq(schema.user.email, email), eq(schema.user.organisationId, organisationId)),
    });
    if (existingUser) throw new ConflictError('A user with this email already exists in this organisation');

    const existingPending = await db.query.invitation.findFirst({
      where: and(
        eq(schema.invitation.email, email),
        eq(schema.invitation.organisationId, organisationId),
        eq(schema.invitation.status, 'pending')
      ),
    });
    if (existingPending) {
      throw new ConflictError('A pending invitation already exists for this email — revoke it first if you want to send a new one');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const [created] = await db
      .insert(schema.invitation)
      .values({
        organisationId,
        teamId: teamId || null,
        roleId: role.id,
        invitedBy: invitedByUserId,
        email,
        token,
        expiresAt,
      })
      .returning();

    await auditWrite(organisationId, invitedByUserId, 'create', 'invitation', created.id, null, { email, roleName, teamId: teamId || null }, 'invitations');

    return created;
  }

  async list(organisationId, status) {
    const conditions = [eq(schema.invitation.organisationId, organisationId)];
    if (status) conditions.push(eq(schema.invitation.status, status));
    return db.select().from(schema.invitation).where(and(...conditions));
  }

  async revoke(organisationId, invitationId, revokedByUserId) {
    const invite = await db.query.invitation.findFirst({
      where: and(eq(schema.invitation.id, invitationId), eq(schema.invitation.organisationId, organisationId)),
    });
    if (!invite) throw new NotFoundError('Invitation not found');
    if (invite.status !== 'pending') {
      throw new BadRequestError(`Cannot revoke an invitation with status '${invite.status}'`);
    }

    const [updated] = await db
      .update(schema.invitation)
      .set({ status: 'revoked' })
      .where(eq(schema.invitation.id, invitationId))
      .returning();

    await auditWrite(organisationId, revokedByUserId, 'update', 'invitation', invitationId, { status: 'pending' }, { status: 'revoked' }, 'invitations');

    return updated;
  }

  /**
   * Public — the invitee redeems their token. Creates the user directly
   * active (an org_admin already vetted them by sending the invite, unlike
   * self-registration which needs a separate approval step) and immediately
   * issues a login JWT so they don't have to separately call /auth/login.
   */
  async accept({ token, password, firstName, lastName, phone }) {
    const invite = await db.query.invitation.findFirst({ where: eq(schema.invitation.token, token) });
    if (!invite) throw new NotFoundError('Invalid or expired invitation');

    if (invite.status !== 'pending') {
      throw new BadRequestError(`This invitation has already been ${invite.status}`);
    }
    if (new Date(invite.expiresAt) < new Date()) {
      await db.update(schema.invitation).set({ status: 'expired' }).where(eq(schema.invitation.id, invite.id));
      throw new BadRequestError('This invitation has expired');
    }

    const existingUser = await db.query.user.findFirst({
      where: and(eq(schema.user.email, invite.email), eq(schema.user.organisationId, invite.organisationId)),
    });
    if (existingUser) throw new ConflictError('A user with this email already exists in this organisation');

    const passwordHash = await bcrypt.hash(password, 10);

    const [newUser] = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(schema.user)
        .values({
          organisationId: invite.organisationId,
          email: invite.email,
          passwordHash,
          firstName,
          lastName,
          phone: phone || null,
          status: 'active',
        })
        .returning();

      await tx.insert(schema.userTeamRole).values({
        userId: u.id,
        teamId: invite.teamId,
        roleId: invite.roleId,
        assignedBy: invite.invitedBy,
      });

      await tx
        .update(schema.invitation)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(schema.invitation.id, invite.id));

      return [u];
    });

    await auditWrite(invite.organisationId, newUser.id, 'update', 'invitation', invite.id, { status: 'pending' }, { status: 'accepted' }, 'invitations');

    const roles = await authService.getActiveRoles(newUser.id);
    const authToken = jwt.sign(
      {
        userId: newUser.id,
        organisationId: newUser.organisationId,
        email: newUser.email,
        roles: roles.map(({ teamId, roleName, permissions }) => ({ teamId, roleName, permissions })),
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return {
      token: authToken,
      user: {
        id: newUser.id,
        organisationId: newUser.organisationId,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        status: newUser.status,
      },
      roles,
    };
  }
}

module.exports = new InvitationsService();
