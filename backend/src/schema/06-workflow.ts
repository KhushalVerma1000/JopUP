/**
 * MODULE 6 — WORKFLOW ENGINE
 * module_key: "workflow_engine"
 *
 * Pipeline templates define the stages a candidate goes through for a
 * specific team or job posting. Every application follows exactly one
 * workflow template.
 *
 * Tables:
 *   workflow_template  — named collection of stages (one default per team)
 *   workflow_stage     — an individual stage in a template
 *
 * Key design decisions:
 *   - is_default: exactly ONE template per team should have this = true
 *     Application enforces: when setting a new default, unset the old one.
 *   - stage_key: machine-readable key for the stage (used in event payloads
 *     and business logic, e.g. "applied", "interview", "offer")
 *   - order_index: integer spacing (10, 20, 30...) allows inserting stages
 *     between existing ones without reordering the whole set
 *   - is_blockable: whether a candidate can be rejected/blocked at this stage
 *   - requires_approval: whether advancing from this stage needs manager sign-off
 *   - is_final_success: exactly one stage per template (e.g. "Joined")
 *
 * Default stage sequence (seeded for every new team):
 *   Applied(10) → Screening(20) → Line-up(30) → Turn up(40)
 *   → Interview(50) → Offer(60) → Joined(70)
 */

import { pgTable, uuid, text, integer, boolean, index } from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";

// ─── Tables ──────────────────────────────────

/**
 * workflow_template
 * A named pipeline belonging to a team. One template can be shared
 * across multiple job postings. Teams start with one default template.
 */
export const workflowTemplate = pgTable("workflow_template", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
  createdBy:      uuid("created_by").notNull().references(() => user.id),

  name:           text("name").notNull(),
  description:    text("description"),

  // Exactly one template per team should have is_default = true.
  // When setting a new default, unset all others for that team first.
  isDefault:      boolean("is_default").notNull().default(false),

  ...timestamps,
}, (t) => [
  index("wt_org_idx").on(t.organisationId),
  index("wt_team_idx").on(t.teamId),
]);

/**
 * workflow_stage
 * A single step in a workflow template.
 * order_index uses 10-spacing so stages can be inserted without full reorder.
 */
export const workflowStage = pgTable("workflow_stage", {
  id:                 pkUuid(),
  workflowTemplateId: uuid("workflow_template_id")
                        .notNull()
                        .references(() => workflowTemplate.id, { onDelete: "cascade" }),

  name:              text("name").notNull(),
  stageKey:          text("stage_key").notNull(),
  // Machine-readable: "applied" | "screening" | "lineup" | "turnup"
  //                 | "interview" | "offer" | "joined"

  description:       text("description"),
  orderIndex:        integer("order_index").notNull(),
  // Use 10-spacing: 10, 20, 30 ... so inserting between is easy

  // Whether candidates can be blocked/rejected at this stage
  isBlockable:       boolean("is_blockable").notNull().default(true),

  // Whether advancing FROM this stage requires manager approval
  requiresApproval:  boolean("requires_approval").notNull().default(false),

  // Exactly one stage per template should be the final success state (e.g. "Joined")
  isFinalSuccess:    boolean("is_final_success").notNull().default(false),

  ...createdAt,
}, (t) => [
  index("ws_template_idx").on(t.workflowTemplateId),
  index("ws_order_idx").on(t.workflowTemplateId, t.orderIndex),
]);
