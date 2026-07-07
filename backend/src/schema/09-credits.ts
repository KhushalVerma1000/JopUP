/**
 * MODULE 9 — CREDIT SYSTEM
 *
 * Metered billing for credit-costing actions (SMS, AI screening,
 * bulk exports, resume parsing, etc.). Credits are consumed per
 * action and topped up each billing cycle per the plan allowance.
 *
 * Tables:
 *   credit_account      — one ledger account per organisation
 *   credit_transaction  — every credit movement (append-only ledger)
 *   credit_cost         — platform-controlled pricing table for each action
 *
 * Key design decisions:
 *   - credit_account.balance is the live spendable balance.
 *     Application must check balance BEFORE deducting.
 *   - credit_transaction.balance_after is stored on each row so you can
 *     reconstruct the ledger at any point without summing everything.
 *   - credit_cost is the single source of truth for action prices.
 *     Changing SMS cost from 1→2 credits = update one row, no code change.
 *   - type values:
 *       earned       — cycle top-up from plan allowance
 *       topped_up    — manual purchase / add-on purchase
 *       spent        — consumed by an action
 *       refunded     — action failed or was reversed
 *       expired      — unused credits at end of cycle (if expiry policy set)
 *       adjusted     — platform admin manual correction
 *
 * Credit check flow (enforced at application layer before any action):
 *   1. Is module enabled for this org?
 *   2. Is credits_enabled for this plan?
 *   3. Does credit_account.balance >= credit_cost.cost for this action?
 *   4. Insert credit_transaction (type=spent, amount=cost)
 *   5. Update credit_account.balance -= cost
 *   6. Proceed with the action
 *   7. If action fails: insert refund transaction, restore balance
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, orgId, createdAt } from "./_helpers";
import { organisation, user } from "./02-identity";

// ─── Enums ───────────────────────────────────

export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
  "earned",
  "topped_up",
  "spent",
  "refunded",
  "expired",
  "adjusted",
]);

// ─── Tables ──────────────────────────────────

/**
 * credit_account
 * One per organisation. The live credit balance ledger.
 * balance         = current spendable credits
 * lifetime_earned = total ever credited (never decrements)
 * lifetime_spent  = total ever consumed (never decrements)
 * These two lifetime fields let you show usage stats without scanning transactions.
 */
export const creditAccount = pgTable("credit_account", {
  id:              pkUuid(),
  organisationId:  orgId().notNull().unique()
                     .references(() => organisation.id, { onDelete: "cascade" }),
  balance:         integer("balance").notNull().default(0),
  lifetimeEarned:  integer("lifetime_earned").notNull().default(0),
  lifetimeSpent:   integer("lifetime_spent").notNull().default(0),
  updatedAt:       timestamp("updated_at", { withTimezone: true })
                     .notNull().default(sql`now()`),
}, (t) => [
  index("ca_org_idx").on(t.organisationId),
]);

/**
 * credit_transaction
 * Append-only ledger entry for every credit movement.
 * balance_after: snapshot of account balance after this transaction —
 * allows point-in-time reconstruction without summing.
 *
 * module_key + action_key: what consumed the credits
 * entity_id + entity_type: the thing the action was performed on
 *   e.g. entity_type="application", entity_id="<uuid>" for an SMS to a candidate
 */
export const creditTransaction = pgTable("credit_transaction", {
  id:                 pkUuid(),
  organisationId:     orgId().references(() => organisation.id, { onDelete: "cascade" }),
  creditAccountId:    uuid("credit_account_id").notNull()
                        .references(() => creditAccount.id),
  actorId:            uuid("actor_id").references(() => user.id, { onDelete: "set null" }),

  type:               creditTransactionTypeEnum("type").notNull(),
  amount:             integer("amount").notNull(),
  // Always positive. Sign is inferred from type (spent/expired = debit)

  balanceAfter:       integer("balance_after").notNull(),
  // Snapshot of balance after this transaction applied

  moduleKey:          text("module_key"),
  actionKey:          text("action_key"),
  description:        text("description"),

  entityId:           uuid("entity_id"),
  entityType:         text("entity_type"),
  // What was the action performed on?

  ...createdAt,
}, (t) => [
  index("ct_org_idx").on(t.organisationId),
  index("ct_account_idx").on(t.creditAccountId),
  index("ct_type_idx").on(t.type),
  index("ct_created_idx").on(t.createdAt),
]);

/**
 * credit_cost
 * Platform-controlled pricing table. Each action that costs credits
 * has one row. Changing prices here takes effect immediately.
 *
 * module_key + action_key = composite lookup key
 * Example rows:
 *   module_key="sms_notifications",   action_key="send_sms",         cost=1
 *   module_key="candidate_db",        action_key="resume_parse",      cost=3
 *   module_key="job_portal",          action_key="featured_listing",  cost=10
 *   module_key="analytics",           action_key="bulk_export",       cost=5
 *   module_key="ai_screening",        action_key="ai_screen_batch",   cost=2
 */
export const creditCost = pgTable("credit_cost", {
  id:          pkUuid(),
  moduleKey:   text("module_key").notNull(),
  actionKey:   text("action_key").notNull(),
  description: text("description"),
  cost:        integer("cost").notNull(),
  active:      boolean("active").notNull().default(true),
  updatedAt:   timestamp("updated_at", { withTimezone: true })
                 .notNull().default(sql`now()`),
}, (t) => [
  index("cc_module_action_idx").on(t.moduleKey, t.actionKey),
]);
