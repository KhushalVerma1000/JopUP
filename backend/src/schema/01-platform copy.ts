/**
 * MODULE 1 — PLATFORM
 *
 * Manages subscription plans, the module registry, and their limit
 * definitions. Owned by the platform admin team. No organisation_id
 * here — these are global records that all tenants reference.
 *
 * Tables:
 *   module_definition — canonical registry of every toggleable module
 *   plan               — subscription tiers sold to organisations
 *   subscription        — billing record linking an org to a plan
 *
 * Key design decisions:
 *   - module_definition is the SINGLE SOURCE OF TRUTH for module_key
 *     strings used everywhere else (plan.modules, org_module_override,
 *     credit_cost, event_log.source_module). Nothing else may introduce
 *     a new module_key without a row here first — this is what makes
 *     the plan-toggle system safe to drive from an admin UI: render a
 *     checkbox per active module_definition row, grouped by category,
 *     instead of hardcoding module names in application code.
 *   - plan.modules  is a jsonb string[] of module_definition.key values
 *                   e.g. ["client_management","candidate_db","workflow_engine"]
 *   - plan.limits   is a jsonb object of hard caps per plan
 *                   e.g. { max_teams: 10, max_hrs_per_team: 20, max_candidates: 5000 }
 *   - plan.credit_allowance is the monthly credit top-up for orgs on this plan
 *   - Adding a new module to a plan = update one jsonb array, no migrations.
 *     Adding a brand NEW module to the platform = insert one
 *     module_definition row, no migrations to plan/org tables.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  decimal,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, createdAt } from "./_helpers";

// ─── Enums ───────────────────────────────────

export const planStatusEnum = pgEnum("plan_status", [
  "active",
  "deprecated",
  "hidden",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "paused",
]);

export const billingCycleEnum = pgEnum("billing_cycle", [
  "monthly",
  "yearly",
]);

export const moduleCategoryEnum = pgEnum("module_category", [
  "core",           // identity, teams, workflow — always on, not sold separately
  "recruit",        // candidate_db, job_posting, pipeline_tracker
  "crm",            // client_management, lead/interaction tracking
  "finance",        // finance_management (FinMa) — invoicing, AR/AP
  "hr",             // employee_hr (PowerEmp) — payroll, onboarding
  "bench",          // bench_sales (BenchPro)
  "communication",  // email_campaigns (EmailPro), sms_notifications
  "vendor",         // vendor_management (VRO)
  "portal",         // job_portal — public job-seeker facing
  "analytics",      // kpi_engine, performance_reviews, strategy_planner
]);

export const moduleStatusEnum = pgEnum("module_status", [
  "active",       // sellable / toggleable today
  "beta",         // toggleable but flagged as beta in the UI
  "deprecated",   // existing orgs keep access, not offered on new plans
  "hidden",       // internal/platform-only, never shown in toggle UI
]);

// ─── Tables ──────────────────────────────────

/**
 * module_definition
 * The canonical registry of every feature module in the platform.
 * Drives the plan-builder and org-override toggle UIs dynamically —
 * no code changes needed to launch, rename, or retire a module.
 *
 * key            — the string stored in plan.modules[] / org_module_override.module_key
 * category       — groups modules for the toggle UI (see moduleCategoryEnum)
 * is_credit_gated — true if actions inside this module can consume credits
 *                   (cross-checked against credit_cost.module_key)
 * depends_on     — jsonb string[] of other module keys this one requires
 *                   e.g. bench_sales depends on ["candidate_db"]
 * sort_order     — display order within a category
 */
export const moduleDefinition = pgTable("module_definition", {
  id:            pkUuid(),
  key:           text("key").notNull().unique(),
  name:          text("name").notNull(),
  description:   text("description"),
  category:      moduleCategoryEnum("category").notNull(),
  status:        moduleStatusEnum("status").notNull().default("active"),
  isCreditGated: boolean("is_credit_gated").notNull().default(false),
  dependsOn:     jsonb("depends_on").notNull().default(sql`'[]'::jsonb`),
  sortOrder:     integer("sort_order").notNull().default(0),
  ...createdAt,
}, (t) => [
  index("module_def_category_idx").on(t.category),
  index("module_def_status_idx").on(t.status),
]);

/**
 * plan
 * One row per subscription tier (Basic, Pro, Enterprise, etc.)
 *
 * modules  — string[] of module keys activated on this plan
 * limits   — { max_teams, max_hrs_per_team, max_candidates,
 *              max_clients, max_job_postings, max_storage_mb }
 */
export const plan = pgTable("plan", {
  id:                pkUuid(),
  name:              text("name").notNull(),
  slug:              text("slug").notNull().unique(),
  description:       text("description"),
  priceMonthly:      decimal("price_monthly", { precision: 10, scale: 2 }),
  priceYearly:       decimal("price_yearly", { precision: 10, scale: 2 }),

  // Module access — array of module_key strings
  modules:           jsonb("modules").notNull().default(sql`'[]'::jsonb`),

  // Hard limits enforced at application layer
  limits:            jsonb("limits").notNull().default(sql`'{}'::jsonb`),

  // Credits allocated each billing cycle (0 = credits not used on this plan)
  creditAllowance:   integer("credit_allowance").notNull().default(0),
  creditsEnabled:    boolean("credits_enabled").notNull().default(false),

  status:            planStatusEnum("status").notNull().default("active"),
  isPublic:          boolean("is_public").notNull().default(true),
  trialDays:         integer("trial_days").notNull().default(14),
  ...createdAt,
});

/**
 * subscription
 * Billing record — one active subscription per organisation at a time.
 * Historical subscriptions are kept for audit/billing reference.
 */
export const subscription = pgTable("subscription", {
  id:                  pkUuid(),
  organisationId:      uuid("organisation_id").notNull(),
  planId:              uuid("plan_id").notNull().references(() => plan.id),

  status:              subscriptionStatusEnum("status").notNull().default("trialing"),
  billingCycle:        billingCycleEnum("billing_cycle").notNull().default("monthly"),

  // Payment provider reference (Stripe subscription ID etc.)
  paymentRef:          text("payment_ref"),
  paymentProvider:     text("payment_provider").default("stripe"),

  currentPeriodStart:  timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd:    timestamp("current_period_end", { withTimezone: true }),
  trialEndsAt:         timestamp("trial_ends_at", { withTimezone: true }),
  cancelledAt:         timestamp("cancelled_at", { withTimezone: true }),
  ...createdAt,
}, (t) => [
  index("subscription_org_idx").on(t.organisationId),
  index("subscription_status_idx").on(t.status),
]);
