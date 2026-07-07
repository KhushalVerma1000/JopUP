/**
 * MODULE 7 — PIPELINE TRACKER
 * module_key: "pipeline_tracker"
 *
 * Tracks every candidate's journey through a recruitment workflow.
 * This is the operational heart of the platform — what HRs live in daily.
 *
 * Tables:
 *   application           — a candidate being considered for a job posting
 *   application_stage_log — full history of stage movements (append-only)
 *   stage_action          — granular actions taken within a stage
 *   document              — files attached to an application
 *
 * Key design decisions:
 *   CURRENT STAGE RULE:
 *     The current stage is always the application_stage_log row where
 *     exited_at IS NULL. Never store "current_stage_id" on application —
 *     it creates sync bugs. Derive it from the log.
 *
 *   STATUS STATE MACHINE per application_stage_log row:
 *     active → advanced     (moved to next stage)
 *     active → blocked      (failed/rejected at this stage)
 *     active → held         (on hold, not rejected)
 *     active → withdrawn    (candidate withdrew)
 *     Any non-active status sets exited_at automatically.
 *
 *   stage_action types:
 *     note | call_log | email_sent | sms_sent | interview_scheduled |
 *     interview_completed | offer_letter_sent | status_changed |
 *     document_uploaded | approval_requested | approval_granted | approval_rejected
 *
 *   CREDIT COST:
 *     Some stage_actions cost credits (SMS, bulk export, AI screening).
 *     credit_transaction_id links back to the ledger entry.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";
import { candidate } from "./04-candidates";
import { jobPosting } from "./05-job-postings";
import { workflowTemplate, workflowStage } from "./06-workflow";

// ─── Enums ───────────────────────────────────

export const applicationStatusEnum = pgEnum("application_status", [
  "active",       // currently moving through pipeline
  "placed",       // successfully joined
  "rejected",     // rejected/blocked at some stage
  "withdrawn",    // candidate withdrew
  "on_hold",      // paused, not rejected
]);

export const stageLogStatusEnum = pgEnum("stage_log_status", [
  "active",       // candidate currently in this stage
  "advanced",     // moved forward to next stage
  "blocked",      // rejected/failed at this stage
  "held",         // on hold at this stage
  "withdrawn",    // candidate withdrew while in this stage
]);

export const stageActionTypeEnum = pgEnum("stage_action_type", [
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

export const documentTypeEnum = pgEnum("document_type", [
  "resume",
  "offer_letter",
  "signed_offer",
  "assessment",
  "id_proof",
  "contract",
  "nda",
  "other",
]);

// ─── Tables ──────────────────────────────────

/**
 * application
 * A candidate being tracked through a workflow for a specific job posting.
 * One candidate can have multiple applications (different postings / re-applications).
 *
 * entry_source mirrors candidate.source — preserved here because the application
 * may be created differently from how the candidate record was created.
 */
export const application = pgTable("application", {
  id:                   pkUuid(),
  organisationId:       orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:               uuid("team_id").notNull().references(() => team.id),
  jobPostingId:         uuid("job_posting_id").references(() => jobPosting.id, { onDelete: "set null" }),
  candidateId:          uuid("candidate_id").notNull().references(() => candidate.id),
  workflowTemplateId:   uuid("workflow_template_id").notNull().references(() => workflowTemplate.id),
  assignedHr:           uuid("assigned_hr").references(() => user.id, { onDelete: "set null" }),

  // How this application was created
  entrySource:          text("entry_source").notNull().default("job_post"),
  // "job_post" | "manual" | "resume_upload" | "referral"

  status:               applicationStatusEnum("status").notNull().default("active"),

  // HR-internal summary notes
  notes:                text("notes"),

  appliedAt:            timestamp("applied_at", { withTimezone: true })
                          .notNull().default(sql`now()`),
  ...timestamps,
}, (t) => [
  index("app_org_idx").on(t.organisationId),
  index("app_team_idx").on(t.teamId),
  index("app_candidate_idx").on(t.candidateId),
  index("app_job_idx").on(t.jobPostingId),
  index("app_status_idx").on(t.status),
]);

/**
 * application_stage_log
 * Append-only history of every stage transition.
 * The row where exited_at IS NULL = current stage.
 *
 * block_reason: required when status = 'blocked' (why was candidate rejected here?)
 * stage_data:   stage-specific data captured at this stage
 *   Interview stage: { slot: "2024-03-15T10:00", interviewer_id: "...", feedback: "" }
 *   Offer stage:     { offered_salary: "12 LPA", joining_date: "2024-04-01" }
 *   Call log:        { called_at: "...", duration_mins: 12, outcome: "positive" }
 */
export const applicationStageLog = pgTable("application_stage_log", {
  id:             pkUuid(),
  applicationId:  uuid("application_id").notNull()
                    .references(() => application.id, { onDelete: "cascade" }),
  stageId:        uuid("stage_id").notNull()
                    .references(() => workflowStage.id),
  movedBy:        uuid("moved_by").references(() => user.id, { onDelete: "set null" }),

  status:         stageLogStatusEnum("status").notNull().default("active"),
  blockReason:    text("block_reason"),
  // Required when status = 'blocked'

  notes:          text("notes"),
  stageData:      jsonb("stage_data").default(sql`'{}'::jsonb`),

  enteredAt:      timestamp("entered_at", { withTimezone: true })
                    .notNull().default(sql`now()`),
  exitedAt:       timestamp("exited_at", { withTimezone: true }),
  // NULL = currently in this stage
}, (t) => [
  index("asl_application_idx").on(t.applicationId),
  index("asl_stage_idx").on(t.stageId),
  index("asl_current_idx").on(t.applicationId, t.exitedAt),
  // Partial index for current stage lookup: WHERE exited_at IS NULL
]);

/**
 * stage_action
 * Granular activities that happen within a stage.
 * Every call, note, email, SMS, interview schedule = one row.
 *
 * metadata: action-specific payload
 *   call_log:             { duration_mins, outcome, callback_scheduled }
 *   interview_scheduled:  { slot, location, interviewer_ids[], video_link }
 *   offer_letter_sent:    { document_id, salary, joining_date }
 *   sms_sent:             { message_preview, credit_cost }
 *   status_changed:       { from_status, to_status, reason }
 *
 * credit_transaction_id: populated when the action consumed credits
 */
export const stageAction = pgTable("stage_action", {
  id:                    pkUuid(),
  applicationStageLogId: uuid("application_stage_log_id")
                           .notNull()
                           .references(() => applicationStageLog.id, { onDelete: "cascade" }),
  performedBy:           uuid("performed_by").notNull().references(() => user.id),

  actionType:            stageActionTypeEnum("action_type").notNull(),
  content:               text("content"),
  // Human-readable note/summary of the action

  metadata:              jsonb("metadata").default(sql`'{}'::jsonb`),
  creditTransactionId:   uuid("credit_transaction_id"),
  // FK to credit_transaction.id — set if action cost credits

  performedAt:           timestamp("performed_at", { withTimezone: true })
                           .notNull().default(sql`now()`),
}, (t) => [
  index("sa_log_idx").on(t.applicationStageLogId),
  index("sa_performer_idx").on(t.performedBy),
  index("sa_type_idx").on(t.actionType),
]);

/**
 * document
 * Files attached to an application (CVs, offer letters, contracts, etc.)
 * File bytes are stored in object storage (S3/R2/GCS).
 * This table stores metadata + access URL only.
 */
export const document = pgTable("document", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  applicationId:  uuid("application_id").notNull()
                    .references(() => application.id, { onDelete: "cascade" }),
  uploadedBy:     uuid("uploaded_by").notNull().references(() => user.id),

  documentType:   documentTypeEnum("document_type").notNull(),
  fileName:       text("file_name").notNull(),
  fileUrl:        text("file_url").notNull(),
  fileSizeBytes:  text("file_size_bytes"),
  mimeType:       text("mime_type"),

  // Offer letters generated by the platform
  isGenerated:    text("is_generated").default("false"),

  ...createdAt,
}, (t) => [
  index("doc_application_idx").on(t.applicationId),
  index("doc_org_idx").on(t.organisationId),
]);
