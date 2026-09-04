/**
 * SEED DATA
 *
 * Run once after first migration to populate:
 *   - Built-in roles (system roles, never deleted)
 *   - Default subscription plans
 *   - Credit cost table
 *
 * Usage:
 *   npx tsx src/seed.ts
 */
import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

// ─── Built-in Roles ──────────────────────────────────────────

const ROLES = [
  {
    name: "platform_admin",
    scope: "platform" as const,
    description: "Full platform access — Anthropic/platform team only",
    permissions: {
      organisations: ["read", "write", "delete", "impersonate"],
      subscriptions: ["read", "write", "cancel"],
      plans: ["read", "write", "delete"],
      audit_log: ["read"],
      // NOTE: was "credit_accounts" (plural) here vs. "credit_account" (singular)
      // on org_admin below — inconsistent keys meant requirePermission('credit_account', ...)
      // could never match this role. Aligned to the singular key both routes use.
      credit_account: ["read", "write", "adjust"],
    },
    isSystem: true,
  },
  {
    name: "org_admin",
    scope: "org" as const,
    description: "Full org access — manage all teams, users, settings",
    permissions: {
      teams: ["read", "write", "delete"],
      users: ["read", "write", "delete", "invite"],
      clients: ["read", "write", "delete", "share"],
      candidates: ["read", "write", "delete", "share"],
      // "archive" was never implemented (job-postings.service.js only has
      // closeJobPosting, no archive action) — replaced with the real actions.
      job_postings: ["read", "write", "publish", "close", "delete"],
      // Template management only. Advancing/blocking/holding an application
      // through a workflow is a separate 'workflow_actions' permission below —
      // org_admin gets both since they can do everything.
      workflow: ["read", "write"],
      workflow_actions: ["advance", "block", "hold", "approve"],
      applications: ["read", "write"],
      kpi: ["read", "write"],
      strategy: ["read", "write"],
      audit_log: ["read"],
      credit_account: ["read"],
    },
    isSystem: true,
  },
  {
    name: "manager",
    scope: "team" as const,
    description: "Own team: full client/pipeline/KPI/strategy access",
    permissions: {
      clients: ["read", "write", "delete"],
      candidates: ["read", "write"],
      // Managers can view templates to know what stages exist, but only
      // org_admin edits them — so 'read' only, no 'write'.
      job_postings: ["read", "write", "publish", "close"],
      workflow: ["read"],
      workflow_actions: ["advance", "block", "hold", "approve"],
      applications: ["read", "write"],
      kpi: ["read", "write"],
      performance_reviews: ["read", "write"],
      goals: ["read", "write"],
      strategy: ["read", "write"],
      team_members: ["read"],
      audit_log: ["read"],
    },
    isSystem: true,
  },
  {
    name: "hr",
    scope: "team" as const,
    description: "Own team: candidate pipeline, job postings, workflow actions",
    permissions: {
      clients: ["read"],
      candidates: ["read", "write"],
      job_postings: ["read", "write", "publish"],
      workflow: ["read"],
      workflow_actions: ["advance", "block", "hold"],
      applications: ["read", "write"],
      kpi: ["read"],
      performance_reviews: ["read"],
      goals: ["read"],
      documents: ["read", "write"],
    },
    isSystem: true,
  },
];

// ─── Default Plans ───────────────────────────────────────────

const PLANS = [
  {
    name: "Starter",
    slug: "starter",
    description: "For small teams getting started",
    priceMonthly: "2999",
    priceYearly: "29990",
    modules: [
      "client_management",
      "candidate_db",
      "job_posting",
      "workflow_engine",
      "pipeline_tracker",
    ],
    limits: {
      max_teams: 2,
      max_hrs_per_team: 5,
      max_candidates: 500,
      max_clients: 20,
      max_job_postings: 10,
      max_storage_mb: 1024,
    },
    creditAllowance: 100,
    creditsEnabled: true,
    trialDays: 14,
  },
  {
    name: "Pro",
    slug: "pro",
    description: "For growing HR teams",
    priceMonthly: "7999",
    priceYearly: "79990",
    modules: [
      "client_management",
      "candidate_db",
      "job_posting",
      "workflow_engine",
      "pipeline_tracker",
      "kpi_engine",
      "performance_reviews",
      "strategy_planner",
      "job_portal",
    ],
    limits: {
      max_teams: 10,
      max_hrs_per_team: 20,
      max_candidates: 5000,
      max_clients: 100,
      max_job_postings: 50,
      max_storage_mb: 10240,
    },
    creditAllowance: 500,
    creditsEnabled: true,
    trialDays: 14,
  },
  {
    name: "Enterprise",
    slug: "enterprise",
    description: "Unlimited scale, dedicated support",
    priceMonthly: "24999",
    priceYearly: "249990",
    modules: [
      "client_management",
      "candidate_db",
      "job_posting",
      "workflow_engine",
      "pipeline_tracker",
      "kpi_engine",
      "performance_reviews",
      "strategy_planner",
      "job_portal",
      "analytics",
      "ai_screening",
      "sms_notifications",
    ],
    limits: {
      max_teams: -1,           // -1 = unlimited
      max_hrs_per_team: -1,
      max_candidates: -1,
      max_clients: -1,
      max_job_postings: -1,
      max_storage_mb: -1,
    },
    creditAllowance: 2000,
    creditsEnabled: true,
    trialDays: 30,
  },
];

// ─── Credit Costs ─────────────────────────────────────────────

const CREDIT_COSTS = [
  // SMS / Notifications
  { moduleKey: "sms_notifications", actionKey: "send_sms", description: "Send SMS to candidate", cost: 1 },
  { moduleKey: "sms_notifications", actionKey: "send_bulk_sms", description: "Bulk SMS (per recipient)", cost: 1 },

  // Resume parsing
  { moduleKey: "candidate_db", actionKey: "resume_parse", description: "Parse uploaded resume", cost: 3 },
  { moduleKey: "candidate_db", actionKey: "bulk_import", description: "Bulk candidate import (per record)", cost: 1 },

  // Job portal
  { moduleKey: "job_portal", actionKey: "featured_listing", description: "Feature a job posting (7 days)", cost: 10 },
  { moduleKey: "job_portal", actionKey: "boost_listing", description: "Boost listing visibility (3 days)", cost: 5 },

  // Analytics / exports
  { moduleKey: "analytics", actionKey: "bulk_export", description: "Export report to CSV/XLSX", cost: 5 },
  { moduleKey: "analytics", actionKey: "advanced_report", description: "Generate advanced analytics report", cost: 10 },

  // AI features
  { moduleKey: "ai_screening", actionKey: "ai_screen_single", description: "AI screen one candidate", cost: 2 },
  { moduleKey: "ai_screening", actionKey: "ai_screen_batch", description: "AI screen up to 10 candidates", cost: 15 },
  { moduleKey: "ai_screening", actionKey: "ai_match_jobs", description: "AI job-candidate matching", cost: 3 },

  // Offer letters
  { moduleKey: "pipeline_tracker", actionKey: "generate_offer", description: "Generate offer letter from template", cost: 2 },
];

// ─── Seed Runner ─────────────────────────────────────────────

async function seed() {
  console.log("🌱 Seeding database...\n");

  // Roles
  console.log("  → Inserting roles...");
  for (const roleData of ROLES) {
    // Roles are upserted on `name` (unique) rather than onConflictDoNothing():
    // this seed script is also how permission-model changes like this one
    // reach an already-seeded database. isSystem/scope are effectively
    // immutable in practice (all seeded as true/fixed here), but permissions
    // and description are exactly the fields we expect to evolve over time.
    await db
      .insert(schema.role)
      .values({
        ...roleData,
        permissions: roleData.permissions,
      })
      .onConflictDoUpdate({
        target: schema.role.name,
        set: {
          description: roleData.description,
          permissions: roleData.permissions,
        },
      });
  }
  console.log(`     ✓ ${ROLES.length} roles`);

  // Plans
  console.log("  → Inserting plans...");
  for (const planData of PLANS) {
    await db
      .insert(schema.plan)
      .values({
        ...planData,
        modules: planData.modules,
        limits: planData.limits,
      })
      .onConflictDoNothing();
  }
  console.log(`     ✓ ${PLANS.length} plans`);

  // Credit costs
  console.log("  → Inserting credit costs...");
  for (const cost of CREDIT_COSTS) {
    await db
      .insert(schema.creditCost)
      .values(cost)
      .onConflictDoNothing();
  }
  console.log(`     ✓ ${CREDIT_COSTS.length} credit cost entries`);

  console.log("\n✅ Seed complete.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
