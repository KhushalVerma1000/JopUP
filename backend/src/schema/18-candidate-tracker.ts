/**
 * MODULE 18 — CANDIDATE TRACKER (live pipeline)
 * module_key: "pipeline_tracker" (same gate as module 7 — this replaces
 * module 7's stage-tracking mechanism; see 07-pipeline.ts's docstring)
 *
 * The live, continuously-updated record of a candidate's journey — what
 * HR works in daily. Named candidate_tracker (not "tracker") specifically
 * to avoid colliding with module 16's `tracker` table, which is a frozen,
 * emailed snapshot sent to a client and must never change after send.
 * The two are producer/consumer, not competitors: "generate a tracker" in
 * module 16 means reading current candidate_tracker rows and freezing
 * their values into a tracker.rows snapshot at that moment.
 *
 * Tables:
 *   candidate_tracker            — one row per candidate being tracked
 *   candidate_tracker_stage_log  — full history of stage movements (append-only)
 *   candidate_tracker_action     — granular actions taken within a stage
 *
 * Key design decisions (carried over unchanged from module 7's original
 * pipeline design — same rules, same reasons, just moved here):
 *   CURRENT STAGE RULE:
 *     The current stage is always the candidate_tracker_stage_log row
 *     where exited_at IS NULL. Never store "current_stage_id" on
 *     candidate_tracker — derive it from the log.
 *
 *   STATUS STATE MACHINE per candidate_tracker_stage_log row:
 *     active → advanced     (moved to next stage)
 *     active → blocked      (failed/rejected at this stage)
 *     active → held         (on hold, not rejected)
 *     active → withdrawn    (candidate withdrew)
 *     Any non-active status sets exited_at automatically.
 *
 *   open_position_id is nullable: HR can start tracking a candidate before
 *   a formal requisition exists (see 17-open-position.ts). A tracker row is
 *   created either from a formal application (candidate applied to a
 *   job_posting) or directly by HR ("quick add" a candidate + track them) —
 *   either path creates exactly one candidate_tracker row and all
 *   advance/hold/block actions operate on it. One engine, one source of
 *   truth, regardless of entry path.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";
import { candidate } from "./04-candidates";
import { openPosition } from "./17-open-position";
import { workflowTemplate, workflowStage } from "./06-workflow";

// ─── Enums ───────────────────────────────────

export const trackerStatusEnum = pgEnum("candidate_tracker_status", [
  "active",       // currently moving through pipeline
  "placed",       // successfully joined
  "rejected",     // rejected/blocked at some stage
  "withdrawn",    // candidate withdrew
  "on_hold",      // paused, not rejected
]);

export const trackerStageLogStatusEnum = pgEnum("candidate_tracker_stage_log_status", [
  "active",       // candidate currently in this stage
  "advanced",     // moved forward to next stage
  "blocked",      // rejected/failed at this stage
  "held",         // on hold at this stage
  "withdrawn",    // candidate withdrew while in this stage
]);

export const trackerActionTypeEnum = pgEnum("candidate_tracker_action_type", [
  "note",
  "call_log",
  "email_sent",
  "sms_sent",
  "interview_scheduled",
  "interview_completed",
  "offer_letter_sent",
  "offer_letter_signed",
  "status_changed",
  "document_uploaded",
  "approval_requested",
  "approval_granted",
  "approval_rejected",
  "candidate_contacted",
  "screening_completed",
]);

// ─── Tables ──────────────────────────────────

/**
 * candidate_tracker
 * A candidate being tracked through a workflow — the live pipeline entry.
 * One candidate can have multiple tracker rows (different positions /
 * re-tracking).
 */
export const candidateTracker = pgTable("candidate_tracker", {
  id:                   pkUuid(),
  organisationId:       orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:               uuid("team_id").notNull().references(() => team.id),
  candidateId:          uuid("candidate_id").notNull().references(() => candidate.id),
  // Nullable — see module docstring.
  openPositionId:       uuid("open_position_id").references(() => openPosition.id, { onDelete: "set null" }),
  workflowTemplateId:   uuid("workflow_template_id").notNull().references(() => workflowTemplate.id),
  assignedHr:           uuid("assigned_hr").references(() => user.id, { onDelete: "set null" }),

  status:               trackerStatusEnum("status").notNull().default("active"),

  interviewDate:        timestamp("interview_date", { withTimezone: true }),
  lineupDate:           timestamp("lineup_date", { withTimezone: true }),

  // HR-internal summary notes
  notes:                text("notes"),

  ...timestamps,
}, (t) => [
  index("ctr_org_idx").on(t.organisationId),
  index("ctr_team_idx").on(t.teamId),
  index("ctr_candidate_idx").on(t.candidateId),
  index("ctr_open_position_idx").on(t.openPositionId),
  index("ctr_status_idx").on(t.status),
  // One *live* tag per candidate per position. Finished rows (rejected,
  // withdrawn, placed) are exempt so a candidate can be re-tagged later.
  uniqueIndex("ctr_one_live_tag_uq").on(t.candidateId, t.openPositionId)
    .where(sql`${t.openPositionId} is not null and ${t.status} in ('active', 'on_hold')`),
]);

/**
 * candidate_tracker_stage_log
 * Append-only history of every stage transition.
 * The row where exited_at IS NULL = current stage.
 */
export const candidateTrackerStageLog = pgTable("candidate_tracker_stage_log", {
  id:             pkUuid(),
  trackerId:      uuid("tracker_id").notNull()
                    .references(() => candidateTracker.id, { onDelete: "cascade" }),
  stageId:        uuid("stage_id").notNull()
                    .references(() => workflowStage.id),
  movedBy:        uuid("moved_by").references(() => user.id, { onDelete: "set null" }),

  status:         trackerStageLogStatusEnum("status").notNull().default("active"),
  blockReason:    text("block_reason"),
  // Required when status = 'blocked'

  notes:          text("notes"),
  stageData:      jsonb("stage_data").default(sql`'{}'::jsonb`),

  enteredAt:      timestamp("entered_at", { withTimezone: true })
                    .notNull().default(sql`now()`),
  exitedAt:       timestamp("exited_at", { withTimezone: true }),
  // NULL = currently in this stage
}, (t) => [
  index("ctsl_tracker_idx").on(t.trackerId),
  index("ctsl_stage_idx").on(t.stageId),
  index("ctsl_current_idx").on(t.trackerId, t.exitedAt),
  // Partial index for current stage lookup: WHERE exited_at IS NULL
]);

/**
 * candidate_tracker_action
 * Granular activities that happen within a stage.
 * Every call, note, email, SMS, interview schedule = one row.
 */
export const candidateTrackerAction = pgTable("candidate_tracker_action", {
  id:               pkUuid(),
  stageLogId:       uuid("stage_log_id")
                      .notNull()
                      .references(() => candidateTrackerStageLog.id, { onDelete: "cascade" }),
  performedBy:      uuid("performed_by").notNull().references(() => user.id),

  actionType:       trackerActionTypeEnum("action_type").notNull(),
  content:          text("content"),
  // Human-readable note/summary of the action

  metadata:         jsonb("metadata").default(sql`'{}'::jsonb`),
  creditTransactionId: uuid("credit_transaction_id"),
  // FK to credit_transaction.id — set if action cost credits

  performedAt:      timestamp("performed_at", { withTimezone: true })
                      .notNull().default(sql`now()`),
}, (t) => [
  index("cta_log_idx").on(t.stageLogId),
  index("cta_performer_idx").on(t.performedBy),
  index("cta_type_idx").on(t.actionType),
]);
