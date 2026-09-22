const { db, schema } = require('../../utils/db');
const { eq, and, inArray } = require('drizzle-orm');
const bcrypt = require('bcryptjs');
const { NotFoundError, BadRequestError } = require('../../utils/errors');

class OrganizationService {
  async getAllOrganizations() {
    return await db.select().from(schema.organisation);
  }

  /**
   * NOTE: previously used db.query.organisation.findFirst({ with: { plan: true } }).
   * That crashes — even calls with no `with` at all crash the same way for
   * this table — with "Cannot read properties of undefined (reading
   * 'referencedTable')". Confirmed via the e2e test script against a real
   * Postgres instance; this is a known drizzle-orm issue (see e.g.
   * drizzle-team/drizzle-orm discussions #2456, #2718) that surfaces on
   * tables with many inbound foreign keys when no explicit relations() are
   * declared — which is every table in this schema (grep confirms zero
   * relations()/defineRelations() calls anywhere in src/schema). Same bug
   * affects db.query.client.findFirst, db.query.workflowTemplate.findFirst,
   * and likely several other db.query.*.findFirst call sites across the
   * codebase (candidates/job-postings/applications/etc.) — those are
   * unverified and NOT fixed here; this fix is scoped to the 3 call sites
   * this test run actually hit. The permanent fix is declaring explicit
   * relations() for the schema rather than relying on Drizzle's automatic
   * FK-based inference.
   */
  async getOrganizationById(id) {
    const [org] = await db.select().from(schema.organisation).where(eq(schema.organisation.id, id));

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const [plan] = await db.select().from(schema.plan).where(eq(schema.plan.id, org.planId));
    return { ...org, plan: plan || null };
  }

  /**
   * Creates the org and (optionally) its first org_admin user in one
   * transaction. Before this, POST /organizations (public tenant signup)
   * created only the org row — there was then no HTTP path to ever get an
   * org_admin for it: self-registration caps out at hr/manager, and sending
   * an invitation for the org_admin role requires already *being* an
   * org_admin. The only way around it was a direct DB insert, same as
   * platform_owner provisioning. Passing all four admin* fields here closes
   * that gap for the common case (whoever signs up the org becomes its
   * first admin); omitting them preserves the old org-only behavior for
   * platform-admin-driven onboarding.
   */
  async createOrganization(data) {
    const { adminEmail, adminPassword, adminFirstName, adminLastName, adminPhone, ...orgData } = data;
    const adminFieldCount = [adminEmail, adminPassword, adminFirstName, adminLastName]
      .filter((f) => f !== undefined).length;

    if (adminFieldCount > 0 && adminFieldCount < 4) {
      throw new BadRequestError(
        'adminEmail, adminPassword, adminFirstName, and adminLastName must all be provided together to create the first admin, or all omitted'
      );
    }

    return await db.transaction(async (tx) => {
      const [newOrg] = await tx.insert(schema.organisation).values(orgData).returning();

      // Also create a credit account for it
      await tx.insert(schema.creditAccount).values({
        organisationId: newOrg.id,
        balance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0
      });

      let admin = null;
      if (adminFieldCount === 4) {
        const orgAdminRole = await tx.query.role.findFirst({
          where: eq(schema.role.name, 'org_admin')
        });
        if (!orgAdminRole) {
          throw new BadRequestError('org_admin role is not seeded — run `npm run db:seed` first');
        }

        const passwordHash = await bcrypt.hash(adminPassword, 10);
        const [newAdmin] = await tx.insert(schema.user).values({
          organisationId: newOrg.id,
          email: adminEmail,
          passwordHash,
          firstName: adminFirstName,
          lastName: adminLastName,
          phone: adminPhone || null,
          // Active immediately, no approval step — unlike hr/manager
          // self-registration, this person IS the tenant; there's nobody
          // above them in this brand-new org to approve the request.
          status: 'active'
        }).returning();

        await tx.insert(schema.userTeamRole).values({
          userId: newAdmin.id,
          teamId: null,
          roleId: orgAdminRole.id,
          assignedBy: newAdmin.id
        });

        admin = {
          id: newAdmin.id,
          email: newAdmin.email,
          firstName: newAdmin.firstName,
          lastName: newAdmin.lastName
        };
      }

      return { organisation: newOrg, admin };
    });
  }

  /**
   * Public discovery for the frontend's login/register flows — the whole
   * point of this method is that it's safe to call with NO auth, so it only
   * ever returns {id, name, slug}. Never the full org row (plan, domain,
   * credit info, etc. have no business being visible pre-login). Also only
   * resolves 'active' orgs — a suspended/cancelled tenant's slug shouldn't
   * be confirmable by an anonymous caller either.
   */
  async getPublicOrgBySlug(slug) {
    const [org] = await db
      .select({ id: schema.organisation.id, name: schema.organisation.name, slug: schema.organisation.slug })
      .from(schema.organisation)
      .where(
        and(
          eq(schema.organisation.slug, slug),
          // 'trialing' is the DEFAULT status for a freshly signed-up org
          // (confirmed in schema/02-identity.ts's org_status enum:
          // trialing | active | suspended | cancelled) — a filter of just
          // 'active' 404'd on every brand-new org, which is exactly the
          // case this lookup most needs to work for. Only actually hide
          // suspended/cancelled tenants.
          inArray(schema.organisation.status, ['trialing', 'active'])
        )
      );

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    return org;
  }

  /**
   * Same public-safety rule as getPublicOrgBySlug: only {id, name} per
   * team, nothing else (no description, no member counts) — this exists
   * solely so a self-registration form can offer a "pick your team" dropdown
   * without the caller ever needing to know or type a raw team UUID.
   */
  async getPublicTeamsBySlug(slug) {
    const org = await this.getPublicOrgBySlug(slug);
    return await db
      .select({ id: schema.team.id, name: schema.team.name })
      .from(schema.team)
      .where(eq(schema.team.organisationId, org.id));
  }

  async updateOrganization(id, data) {
    const [updatedOrg] = await db
      .update(schema.organisation)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.organisation.id, id))
      .returning();
      
    if (!updatedOrg) {
      throw new NotFoundError('Organization not found');
    }
    
    return updatedOrg;
  }

  async getOrgModules(orgId) {
    // Same db.query.*.findFirst crash as getOrganizationById above — see its
    // docstring. Fixed the same way: plain select + a second query for plan.
    const [org] = await db.select().from(schema.organisation).where(eq(schema.organisation.id, orgId));

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const [plan] = await db.select().from(schema.plan).where(eq(schema.plan.id, org.planId));
    const planModules = new Set(plan?.modules || []);
    
    const overrides = await db
      .select()
      .from(schema.orgModuleOverride)
      .where(eq(schema.orgModuleOverride.organisationId, orgId));
      
    for (const override of overrides) {
      if (override.enabled) {
        planModules.add(override.moduleKey);
      } else {
        planModules.delete(override.moduleKey);
      }
    }
    
    return Array.from(planModules);
  }
}

module.exports = new OrganizationService();
