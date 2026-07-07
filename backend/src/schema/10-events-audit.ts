/**
 * MODULE 10 — EVENT BUS & AUDIT LOG
 *
 * Two related but distinct concerns:
 *
 * event_log     — the async pub/sub backbone (transactional outbox pattern)
 *                 Background workers poll this for unprocessed events and
 *                 fan out to SMS, webhooks, KPI updates, notifications, etc.
 *                 User actions are FAST because they only write here and return.
 *
 * audit_log     — the immutable compliance record of who did what to what.
 *                 Append-only. Never update or delete rows here.
 *                 before_state/after_state let you diff any record at any time.
 *
 * Key design decisions:
 *   EVENT LOG:
 *   - processed = false means the event is queued for workers
 *   - processed_at is set when all subscribers have handled it
 *   - failed_at + error is set if a worker throws — allows retry
 *   - source_module = which module emitted the event
 *   - Workers subscribe to specific event_type patterns:
 *       "candidate.stage_changed"  → SMS worker, KPI worker, notification worker
 *       "job_posting.published"    → job portal sync worker
 *       "application.created"      → assignment worker
 *       "credit.low_balance"       → email alert worker
 *
 *   AUDIT LOG:
 *   - Every important write across all modules creates one audit row
 *   - organisation_id scopes it: org admin sees own org, platform admin sees all
 *   - before_state NULL for creates, after_state NULL for deletes
 *   - ip_address + user_agent for security forensics
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, orgId, createdAt } from "./_helpers";
import { organisation, user } from "./02-identity";

// ─── Tables ──────────────────────────────────

/**
 * event_log
 * Transactional outbox table — the async event bus.
 *
 * Flow:
 *   HR action → INSERT into event_log (processed=false) → return 200 to user
 *   Background worker → SELECT WHERE processed=false ORDER BY occurred_at
 *                     → process event → UPDATE processed=true, processed_at=now()
 *
 * payload: full event data needed by all possible subscribers
 * {
 *   "candidate_id": "...",
 *   "from_stage": "screening",
 *   "to_stage": "lineup",
 *   "moved_by_user_id": "...",
 *   "application_id": "..."
 * }
 */
export const eventLog = pgTable("event_log", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  actorId:        uuid("actor_id").references(() => user.id, { onDelete: "set null" }),

  eventType:      text("event_type").notNull(),
  // Namespaced: "candidate.stage_changed" | "job_posting.published"
  // | "application.created" | "client.shared" | "credit.spent"
  // | "user.invited" | "workflow.stage_blocked"

  entityType:     text("entity_type"),
  entityId:       uuid("entity_id"),

  payload:        jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  sourceModule:   text("source_module").notNull(),

  // Worker processing state
  processed:      boolean("processed").notNull().default(false),
  processedAt:    timestamp("processed_at", { withTimezone: true }),
  failedAt:       timestamp("failed_at", { withTimezone: true }),
  error:          text("error"),
  retryCount:     text("retry_count").default("0"),

  occurredAt:     timestamp("occurred_at", { withTimezone: true })
                    .notNull().default(sql`now()`),
}, (t) => [
  index("event_processed_idx").on(t.processed, t.occurredAt),
  // The hot index: workers poll WHERE processed=false ORDER BY occurred_at
  index("event_org_idx").on(t.organisationId),
  index("event_type_idx").on(t.eventType),
  index("event_entity_idx").on(t.entityType, t.entityId),
]);

/**
 * audit_log
 * Immutable compliance record. Never update or delete rows.
 * Written by every service that modifies important state.
 *
 * entity_type examples: "candidate" | "application" | "client" | "user"
 *   | "job_posting" | "workflow_stage" | "subscription" | "credit_account"
 *
 * action examples: "create" | "update" | "delete" | "stage_advance"
 *   | "stage_block" | "role_assigned" | "role_revoked" | "login"
 *   | "credit_deducted" | "module_enabled" | "client_shared"
 */
export const auditLog = pgTable("audit_log", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  actorId:        uuid("actor_id").references(() => user.id, { onDelete: "set null" }),

  action:         text("action").notNull(),
  entityType:     text("entity_type").notNull(),
  entityId:       uuid("entity_id"),

  beforeState:    jsonb("before_state"),
  afterState:     jsonb("after_state"),

  // Request metadata for security forensics
  ipAddress:      text("ip_address"),
  userAgent:      text("user_agent"),

  // Module that triggered the audit entry
  sourceModule:   text("source_module"),

  ...createdAt,
}, (t) => [
  index("audit_org_idx").on(t.organisationId, t.createdAt),
  index("audit_actor_idx").on(t.actorId),
  index("audit_entity_idx").on(t.entityType, t.entityId),
  index("audit_action_idx").on(t.action),
]);
