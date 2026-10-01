const crypto = require('crypto');
const { db, schema } = require('../../utils/db');
const { eq, and, inArray } = require('drizzle-orm');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { BadRequestError, NotFoundError, ConflictError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');
const authService = require('../auth/auth.service'); // reuse getActiveRoles for the auto-login-on-accept JWT
const { sendEmail } = require('../../services/email');
const { invitationEmail } = require('../../services/email/templates/invitation');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const INVITATION_TTL_DAYS = 7;

// Whether the raw token is included in API responses. Defaults to true outside
// production (the UI's "Copy token" fallback), false in production where the
// token should only travel inside the invitation email. Override with
// EXPOSE_INVITATION_TOKEN=true|false.
function exposeToken() {
  const v = process.env.EXPOSE_INVITATION_TOKEN;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

function present(invite) {
  if (exposeToken()) return invite;
  const { token, ...rest } = invite;
  return rest;
}

class InvitationsService {
  /**
   * org_admin sends an invitation. This is the only path to the org_admin
   * role — self-registration (auth.service.js) is capped to hr/manager.
   *
   * After the row is created an invitation email is sent via the email
   * service. Delivery failure does NOT roll back the invitation: it is
   * reported as emailSent:false so the caller can tell the admin honestly
   * (outside production the token is also returned as a fallback).
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

    const emailSent = await this.sendInvitationEmail({ created, organisationId, invitedByUserId, roleName, teamId });

    return { invitation: present(created), emailSent };
  }

  /** Best-effort send; never throws. Returns true if the provider accepted it. */
  async sendInvitationEmail({ created, organisationId, invitedByUserId, roleName, teamId }) {
    try {
      const [org] = await db.select({ name: schema.organisation.name }).from(schema.organisation).where(eq(schema.organisation.id, organisationId));
      const [inviter] = await db
        .select({ firstName: schema.user.firstName, lastName: schema.user.lastName })
        .from(schema.user)
        .where(eq(schema.user.id, invitedByUserId));
      const team = teamId
        ? (await db.select({ name: schema.team.name }).from(schema.team).where(eq(schema.team.id, teamId)))[0]
        : null;

      const { subject, html } = invitationEmail({
        orgName: org?.name || 'your organisation',
        inviterName: inviter ? `${inviter.firstName} ${inviter.lastName}`.trim() : null,
        roleName,
        teamName: team?.name || null,
        token: created.token,
        expiresAt: created.expiresAt,
      });

      await sendEmail({ to: created.email, subject, html });
      return true;
    } catch (err) {
      console.error(`[invitations] email to ${created.email} failed: ${err.message}`);
      return false;
    }
  }

  async list(organisationId, status) {
    const conditions = [eq(schema.invitation.organisationId, organisationId)];
    if (status) conditions.push(eq(schema.invitation.status, status));
    const rows = await db.select().from(schema.invitation).where(and(...conditions));

    // Same gap as auth.service.js's listPendingApprovals: roleId/teamId are
    // raw UUIDs with no name resolution. Resolved here so the UI can show
    // "Manager — Recruitment Team A" instead of two UUIDs. `token` is left
    // handled by present(): only included when exposeToken() is true.
    const roleIds = [...new Set(rows.map((r) => r.roleId).filter(Boolean))];
    const teamIds = [...new Set(rows.map((r) => r.teamId).filter(Boolean))];

    const roleRows = roleIds.length
      ? await db.select({ id: schema.role.id, name: schema.role.name }).from(schema.role).where(inArray(schema.role.id, roleIds))
      : [];
    const teamRows = teamIds.length
      ? await db.select({ id: schema.team.id, name: schema.team.name }).from(schema.team).where(inArray(schema.team.id, teamIds))
      : [];

    const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

    return rows.map((r) => ({
      ...present(r),
      roleName: roleNameById.get(r.roleId) || null,
      teamName: teamNameById.get(r.teamId) || null,
    }));
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

    return present(updated);
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
