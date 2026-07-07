/**
 * MODULE 1 — PLATFORM
 *
 * Manages subscription plans and their module/limit definitions.
 * Owned by the platform admin team. No organisation_id here — these
 * are global records that all tenants reference.
 *
 * Tables:
 *   plan            — subscription tiers sold to organisations
 *   subscription    — billing record linking an org to a plan
 *
 * Key design decisions:
 *   - plan.modules  is a jsonb string[] of module keys included in the plan
 *                   e.g. ["client_management","candidate_db","workflow_engine"]
 *   - plan.limits   is a jsonb object of hard caps per plan
 *                   e.g. { max_teams: 10, max_hrs_per_team: 20, max_candidates: 5000 }
 *   - plan.credit_allowance is the monthly credit top-up for orgs on this plan
 *   - Adding a new module to a plan = update one jsonb array, no migrations
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

// ─── Tables ──────────────────────────────────

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
