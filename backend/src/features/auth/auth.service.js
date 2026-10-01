const { db, schema } = require('../../utils/db');
const { eq, and, or, isNull, inArray } = require('drizzle-orm');
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

// Lazily-built bcrypt hash used to burn the same time as a real password
// check when no account matched, so response time doesn't reveal whether
// an email exists.
let dummyHash;
function getDummyHash() {
  if (!dummyHash) dummyHash = bcrypt.hashSync('jopup-timing-equaliser', 10);
  return dummyHash;
}

function toPublicUser(user) {
  const out = {};
  for (const field of PUBLIC_USER_FIELDS) out[field] = user[field];
  return out;
}

const TRIAL_FALLBACK_DAYS = 14;

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
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

  /** Finds a free slug: acme-recruiting, acme-recruiting-2, ... */
  async _uniqueSlug(base) {
    for (let i = 1; i < 50; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      const [hit] = await db
        .select({ id: schema.organisation.id })
        .from(schema.organisation)
        .where(eq(schema.organisation.slug, candidate));
      if (!hit) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  /**
   * Self-serve signup. One transaction creates: organisation (trialing),
   * credit account, a default "General" team, the first org_admin (active),
   * and a 'trialing' subscription. No payment is taken here — the
   * subscription row deliberately has paymentProvider/paymentRef null; the
   * payment module will attach a provider customer to it at checkout and
   * flip status to 'active'. Returns a session so the client can log in
   * straight away.
   */
  async signupOrganisation(data) {
    const planSlug = data.planSlug || 'starter';
    const [plan] = await db.select().from(schema.plan).where(eq(schema.plan.slug, planSlug));
    if (!plan || plan.status !== 'active' || !plan.isPublic) {
      throw new BadRequestError('That plan is not available');
    }

    const orgAdminRole = await db.query.role.findFirst({ where: eq(schema.role.name, 'org_admin') });
    if (!orgAdminRole) {
      throw new BadRequestError('org_admin role is not seeded — run `npm run db:seed` first');
    }

    const slug = await this._uniqueSlug(slugify(data.companyName));
    const passwordHash = await bcrypt.hash(data.password, 10);
    const trialDays = plan.trialDays || TRIAL_FALLBACK_DAYS;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
    const now = new Date();

    const { org, admin, sub } = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(schema.organisation)
        .values({
          planId: plan.id,
          name: data.companyName,
          slug,
          status: 'trialing',
          trialEndsAt,
          timezone: data.timezone || 'UTC',
          defaultCountry: data.defaultCountry ? data.defaultCountry.toUpperCase() : null,
        })
        .returning();

      await tx.insert(schema.creditAccount).values({
        organisationId: org.id,
        balance: plan.creditAllowance || 0,
        lifetimeEarned: plan.creditAllowance || 0,
        lifetimeSpent: 0,
      });

      const [admin] = await tx
        .insert(schema.user)
        .values({
          organisationId: org.id,
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone || null,
          status: 'active',
        })
        .returning();

      await tx.insert(schema.userTeamRole).values({
        userId: admin.id,
        teamId: null,
        roleId: orgAdminRole.id,
        assignedBy: admin.id,
      });

      // Every org needs at least one team before staff can self-register
      // (the register form's team dropdown would otherwise be empty).
      await tx.insert(schema.team).values({
        organisationId: org.id,
        name: 'General',
        description: 'Default team — rename or add more in Managerial',
      });

      const [sub] = await tx
        .insert(schema.subscription)
        .values({
          organisationId: org.id,
          planId: plan.id,
          status: 'trialing',
          billingCycle: 'monthly',
          paymentProvider: null,
          paymentRef: null,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
          trialEndsAt,
        })
        .returning();

      return { org, admin, sub };
    });

    await auditWrite(org.id, admin.id, 'create', 'organisation', org.id, null,
      { name: org.name, slug: org.slug, plan: plan.slug, via: 'self_signup' }, 'auth');

    const session = await this._completeLogin(admin);
    return {
      ...session,
      organisation: { id: org.id, name: org.name, slug: org.slug, status: org.status, trialEndsAt },
      subscription: { id: sub.id, status: sub.status, plan: { slug: plan.slug, name: plan.name }, trialEndsAt },
    };
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

  /**
   * Fresh profile lookup for the "who am I" endpoint. Deliberately re-reads
   * the DB rather than trusting the JWT payload for anything beyond
   * userId/organisationId — status, name, avatar, etc. can all change after
   * the token was issued (e.g. a suspension shouldn't wait for token expiry
   * to be reflected in the UI, even though the token itself stays valid).
   */
  async getMe(organisationId, userId) {
    const user = await db.query.user.findFirst({
      where: and(
        eq(schema.user.id, userId),
        eq(schema.user.organisationId, organisationId)
      ),
    });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return toPublicUser(user);
  }

  /**
   * Log in with email + password. `organisationSlug` is optional.
   *
   * - Slug given (e.g. from a workspace link): look up that org's user,
   *   exactly as before.
   * - No slug: find every account with this email (email is only unique
   *   per organisation) and keep only those whose password matches.
   *     0 matches -> generic "Invalid credentials"
   *     1 match   -> log straight in
   *     2+ matches -> return { orgSelectionRequired, organisations } so the
   *                   client can ask which one, then call again with a slug.
   *   Org names are only ever revealed for accounts whose password the
   *   caller has already proven, so this can't be used to probe which
   *   emails exist in which orgs.
   */
  async login(organisationSlug, email, password) {
    // Deliberately generic error — don't reveal whether the org/email exists.
    const invalid = () => new UnauthorizedError('Invalid credentials');

    if (organisationSlug) {
      const org = await db.query.organisation.findFirst({
        where: eq(schema.organisation.slug, organisationSlug),
      });
      if (!org) {
        await bcrypt.compare(password, getDummyHash());
        throw invalid();
      }
      const user = await db.query.user.findFirst({
        where: and(
          eq(schema.user.email, email),
          eq(schema.user.organisationId, org.id)
        ),
      });
      if (!user || !user.passwordHash) {
        await bcrypt.compare(password, getDummyHash());
        throw invalid();
      }
      if (!(await bcrypt.compare(password, user.passwordHash))) throw invalid();
      return this._completeLogin(user);
    }

    const rows = await db
      .select({ user: schema.user, org: schema.organisation })
      .from(schema.user)
      .innerJoin(schema.organisation, eq(schema.user.organisationId, schema.organisation.id))
      .where(eq(schema.user.email, email));

    const candidates = rows.filter((r) => r.user.passwordHash);
    if (candidates.length === 0) {
      // Equalise timing with the "email exists, wrong password" path.
      await bcrypt.compare(password, getDummyHash());
      throw invalid();
    }

    const matches = [];
    for (const row of candidates) {
      if (await bcrypt.compare(password, row.user.passwordHash)) matches.push(row);
    }

    if (matches.length === 0) throw invalid();
    if (matches.length === 1) return this._completeLogin(matches[0].user);

    return {
      orgSelectionRequired: true,
      organisations: matches
        .map((m) => ({ slug: m.org.slug, name: m.org.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Status gate + token issue, shared by every login path. Password is already verified. */
  async _completeLogin(user) {
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

    // A suspended/cancelled workspace locks everyone in it out, not just
    // new sign-ins to the public lookup (which already hides such orgs).
    const [org] = await db
      .select({ status: schema.organisation.status })
      .from(schema.organisation)
      .where(eq(schema.organisation.id, user.organisationId));
    if (org && (org.status === 'suspended' || org.status === 'cancelled')) {
      throw new UnauthorizedError('This workspace is suspended. Contact JopUP support');
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

  /**
   * List pending self-registration requests visible to the requesting
   * user: org_admins see every pending request in the org; managers see
   * only requests for teams they manage. Optionally narrowed by teamId.
   */
  async listPendingApprovals(organisationId, requestingUserId, teamId) {
    const roles = await this.getActiveRoles(requestingUserId);
    const isOrgAdmin = roles.some((r) => r.roleName === 'org_admin' && r.scope === 'org');
    const managedTeamIds = roles
      .filter((r) => r.roleName === 'manager' && r.scope === 'team' && r.teamId)
      .map((r) => r.teamId);

    if (!isOrgAdmin && managedTeamIds.length === 0) {
      throw new UnauthorizedError('Only an org_admin or a team manager can view pending approvals');
    }

    const conditions = [
      eq(schema.user.organisationId, organisationId),
      eq(schema.user.status, 'pending_approval'),
    ];

    if (teamId) {
      if (!isOrgAdmin && !managedTeamIds.includes(teamId)) {
        throw new UnauthorizedError('You do not manage this team');
      }
      conditions.push(eq(schema.user.requestedTeamId, teamId));
    } else if (!isOrgAdmin) {
      // Manager without a teamId filter: scope to their own teams only.
      conditions.push(or(...managedTeamIds.map((id) => eq(schema.user.requestedTeamId, id))));
    }

    const rows = await db.select().from(schema.user).where(and(...conditions));

    // Resolve requestedRoleId -> role name and requestedTeamId -> team name
    // so the approver's UI can show what someone actually asked for —
    // without exposing raw UUIDs (same principle as the org/team by-slug
    // lookups) or needing a second round-trip. Cheap: only 5 global roles
    // and a handful of teams per org.
    const roleIds = [...new Set(rows.map((r) => r.requestedRoleId).filter(Boolean))];
    const teamIds = [...new Set(rows.map((r) => r.requestedTeamId).filter(Boolean))];

    const roleRows = roleIds.length
      ? await db.select({ id: schema.role.id, name: schema.role.name }).from(schema.role).where(inArray(schema.role.id, roleIds))
      : [];
    const teamRows = teamIds.length
      ? await db.select({ id: schema.team.id, name: schema.team.name }).from(schema.team).where(inArray(schema.team.id, teamIds))
      : [];

    const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

    return rows.map((r) => ({
      ...toPublicUser(r),
      requestedRoleName: roleNameById.get(r.requestedRoleId) || null,
      requestedTeamName: teamNameById.get(r.requestedTeamId) || null,
    }));
  }

  async approveStaff(organisationId, targetUserId, approverUserId) {
    const target = await db.query.user.findFirst({
      where: and(
        eq(schema.user.id, targetUserId),
        eq(schema.user.organisationId, organisationId)
      ),
    });
    if (!target) throw new NotFoundError('Registration request not found');
    if (target.status !== 'pending_approval') {
      throw new BadRequestError(`Cannot approve a user with status '${target.status}'`);
    }

    const approverIsEligible = await this._isEligibleApprover(
      approverUserId,
      organisationId,
      target.requestedTeamId
    );
    if (!approverIsEligible) {
      throw new UnauthorizedError('Only an org_admin or the manager of this team can approve this request');
    }

    const [updated] = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(schema.user)
        .set({
          status: 'active',
          approvedBy: approverUserId,
          approvedAt: new Date(),
        })
        .where(eq(schema.user.id, targetUserId))
        .returning();

      await tx.insert(schema.userTeamRole).values({
        userId: targetUserId,
        teamId: target.requestedTeamId,
        roleId: target.requestedRoleId,
        assignedBy: approverUserId,
      });

      return [u];
    });

    await auditWrite(
      organisationId,
      approverUserId,
      'update',
      'user',
      targetUserId,
      { status: 'pending_approval' },
      { status: 'active' },
      'auth'
    );

    return toPublicUser(updated);
  }

  async rejectStaff(organisationId, targetUserId, approverUserId, reason) {
    const target = await db.query.user.findFirst({
      where: and(
        eq(schema.user.id, targetUserId),
        eq(schema.user.organisationId, organisationId)
      ),
    });
    if (!target) throw new NotFoundError('Registration request not found');
    if (target.status !== 'pending_approval') {
      throw new BadRequestError(`Cannot reject a user with status '${target.status}'`);
    }

    const approverIsEligible = await this._isEligibleApprover(
      approverUserId,
      organisationId,
      target.requestedTeamId
    );
    if (!approverIsEligible) {
      throw new UnauthorizedError('Only an org_admin or the manager of this team can reject this request');
    }

    const [updated] = await db
      .update(schema.user)
      .set({
        status: 'rejected',
        rejectedBy: approverUserId,
        rejectedAt: new Date(),
        rejectionReason: reason || null,
      })
      .where(eq(schema.user.id, targetUserId))
      .returning();

    await auditWrite(
      organisationId,
      approverUserId,
      'update',
      'user',
      targetUserId,
      { status: 'pending_approval' },
      { status: 'rejected', rejectionReason: reason || null },
      'auth'
    );

    return toPublicUser(updated);
  }
}

module.exports = new AuthService();
