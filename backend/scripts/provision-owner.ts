/**
 * PROVISION OWNER
 *
 * Bootstraps the platform's single "owner" account (role: platform_owner).
 * There is deliberately no HTTP route that can create this role — it's the
 * top of the permission tree (can add/remove platform_admin sub-admins via
 * POST/DELETE /api/v1/platform-admins) and self-registration/invitation are
 * both intentionally blocked for platform-scope roles. This script is the
 * only path to it, and it's meant to be run once, directly against the DB,
 * by whoever controls deploys — not exposed over HTTP at all.
 *
 * Design note: user.organisationId is NOT NULL (see src/schema/02-identity.ts
 * — "ONE user record per person per organisation" is a stated design
 * decision for the whole schema). Platform-scope staff still need *an* org
 * to hang off of, so this script finds-or-creates a dedicated internal
 * organisation (default slug: 'jopup-platform') to hold them. This is not a
 * tenant in the product sense — it never appears in tenant-facing UI, it's
 * just where the identity row lives.
 *
 * Usage:
 *   npx tsx scripts/provision-owner.ts --email=owner@jopup.io --password=... --firstName=Jane --lastName=Doe
 *
 * Flags:
 *   --email        required
 *   --password     required, min 8 chars
 *   --firstName    required
 *   --lastName     required
 *   --org-slug     optional, defaults to 'jopup-platform'
 *   --force        optional — allow provisioning even if an owner already exists
 *
 * Equivalent environment variables (flags win if both are given):
 *   OWNER_EMAIL, OWNER_PASSWORD, OWNER_FIRST_NAME, OWNER_LAST_NAME, OWNER_ORG_SLUG
 */
import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../src/schema";

function parseArgs() {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
    else if (arg.startsWith("--")) args[arg.slice(2)] = "true";
  }
  return {
    email: args.email || process.env.OWNER_EMAIL,
    password: args.password || process.env.OWNER_PASSWORD,
    firstName: args.firstName || process.env.OWNER_FIRST_NAME,
    lastName: args.lastName || process.env.OWNER_LAST_NAME,
    orgSlug: args["org-slug"] || process.env.OWNER_ORG_SLUG || "jopup-platform",
    force: args.force === "true",
  };
}

function usageAndExit(message: string): never {
  console.error(`\n✗ ${message}\n`);
  console.error(
    "Usage: npx tsx scripts/provision-owner.ts --email=owner@jopup.io --password=... --firstName=Jane --lastName=Doe [--org-slug=jopup-platform] [--force]"
  );
  process.exit(1);
}

async function main() {
  const { email, password, firstName, lastName, orgSlug, force } = parseArgs();

  if (!email || !password || !firstName || !lastName) {
    usageAndExit("--email, --password, --firstName and --lastName (or the equivalent OWNER_* env vars) are all required");
  }
  if (password.length < 8) {
    usageAndExit("Password must be at least 8 characters");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const ownerRole = await db.query.role.findFirst({
      where: eq(schema.role.name, "platform_owner"),
    });
    if (!ownerRole) {
      usageAndExit("Role 'platform_owner' not found — run `npm run db:seed` first");
    }

    if (!force) {
      const existingOwner = await db
        .select({ id: schema.userTeamRole.id })
        .from(schema.userTeamRole)
        .where(
          and(
            eq(schema.userTeamRole.roleId, ownerRole!.id),
            isNull(schema.userTeamRole.revokedAt)
          )
        )
        .limit(1);
      if (existingOwner.length > 0) {
        usageAndExit(
          "A platform_owner already exists. Use the admin management routes (POST /api/v1/platform-admins) to add sub-admins, or pass --force to provision another owner anyway."
        );
      }
    }

    // Find-or-create the dedicated internal organisation for platform staff.
    let platformOrg = await db.query.organisation.findFirst({
      where: eq(schema.organisation.slug, orgSlug),
    });

    if (!platformOrg) {
      const anyPlan = await db.query.plan.findFirst();
      if (!anyPlan) {
        usageAndExit("No plans found — run `npm run db:seed` first (plans are seeded there)");
      }
      const [created] = await db
        .insert(schema.organisation)
        .values({
          planId: anyPlan!.id,
          name: "JopUP Platform (Internal)",
          slug: orgSlug,
          status: "active",
        })
        .returning();
      platformOrg = created;
      console.log(`  → Created internal platform organisation (slug: ${orgSlug})`);
    }

    const existingUser = await db.query.user.findFirst({
      where: and(
        eq(schema.user.email, email!),
        eq(schema.user.organisationId, platformOrg!.id)
      ),
    });
    if (existingUser) {
      usageAndExit(`A user with email '${email}' already exists in the platform org`);
    }

    const passwordHash = await bcrypt.hash(password!, 10);

    const [ownerUser] = await db
      .insert(schema.user)
      .values({
        organisationId: platformOrg!.id,
        email: email!,
        passwordHash,
        firstName: firstName!,
        lastName: lastName!,
        status: "active",
      })
      .returning();

    await db.insert(schema.userTeamRole).values({
      userId: ownerUser.id,
      teamId: null,
      roleId: ownerRole!.id,
      assignedBy: null, // self-bootstrapped, not approved by another user
    });

    console.log("\n✓ Owner provisioned successfully.");
    console.log(`  Organisation slug (needed to log in): ${orgSlug}`);
    console.log(`  Email: ${email}`);
    console.log("  Log in via POST /api/v1/auth/login with the organisationSlug above.\n");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✗ Provisioning failed:", err);
  process.exit(1);
});
