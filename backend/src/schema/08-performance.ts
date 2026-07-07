/**
 * MODULE 8 — PERFORMANCE & STRATEGY
 * module_keys: "kpi_engine" | "performance_reviews" | "strategy_planner"
 *
 * Manager-facing tools for team performance visibility and planning.
 *
 * Tables:
 *   kpi_definition     — what to measure (template/target for a team)
 *   kpi_entry          — time-series values recorded against a definition
 *   performance_review — manager reviews HR team member work
 *   goal               — individual or team goals tracked over time
 *   team_strategy      — OKR-style strategy docs per team per period
 *
 * Key design decisions:
 *   - kpi_definition separates the "what" (definition) from the "data" (entries)
 *     so you can plot trends, compare periods, and benchmark across teams
 *   - direction field: "higher_better" | "lower_better" | "target_exact"
 *     allows correct colouring (green/red) in dashboards without hardcoding
 *   - performance_review.scores is jsonb to support any rubric:
 *     { "communication": 4, "delivery": 5, "initiative": 3 }
 *   - team_strategy.objectives is a jsonb OKR array:
 *     [{ "objective": "...", "key_results": [{ "kr": "...", "target": 100, "current": 45 }] }]
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  date,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";

// ─── Enums ───────────────────────────────────

export const kpiFrequencyEnum = pgEnum("kpi_frequency", [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
]);

export const kpiDirectionEnum = pgEnum("kpi_direction", [
  "higher_better",
  "lower_better",
  "target_exact",
]);

export const reviewStatusEnum = pgEnum("review_status", [
  "draft",
  "submitted",
  "acknowledged",
]);

export const goalStatusEnum = pgEnum("goal_status", [
  "active",
  "completed",
  "cancelled",
  "overdue",
]);

export const strategyStatusEnum = pgEnum("strategy_status", [
  "draft",
  "active",
  "archived",
]);

// ─── Tables ──────────────────────────────────

/**
 * kpi_definition
 * Defines what a team is measuring, how often, and what the target is.
 * category examples: "recruitment", "team_performance", "client_delivery"
 * unit examples: "candidates", "days", "%" , "count"
 */
export const kpiDefinition = pgTable("kpi_definition", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
  createdBy:      uuid("created_by").notNull().references(() => user.id),

  name:           text("name").notNull(),
  description:    text("description"),
  category:       text("category"),
  unit:           text("unit"),
  // e.g. "%" | "count" | "days" | "₹"

  frequency:      kpiFrequencyEnum("frequency").notNull().default("monthly"),
  targetValue:    doublePrecision("target_value"),
  direction:      kpiDirectionEnum("direction").notNull().default("higher_better"),

  isActive:       text("is_active").default("true"),
  ...timestamps,
}, (t) => [
  index("kpi_def_team_idx").on(t.teamId),
  index("kpi_def_org_idx").on(t.organisationId),
]);

/**
 * kpi_entry
 * A single measured value for a KPI definition in a period.
 * period_label: human label e.g. "March 2024", "W12 2024", "Q1 2024"
 * period_date:  machine-sortable date representing start of period
 */
export const kpiEntry = pgTable("kpi_entry", {
  id:           pkUuid(),
  kpiId:        uuid("kpi_id").notNull().references(() => kpiDefinition.id, { onDelete: "cascade" }),
  teamId:       uuid("team_id").notNull().references(() => team.id),
  recordedBy:   uuid("recorded_by").notNull().references(() => user.id),

  value:        doublePrecision("value").notNull(),
  periodLabel:  text("period_label").notNull(),
  periodDate:   date("period_date").notNull(),
  notes:        text("notes"),

  ...createdAt,
}, (t) => [
  index("kpi_entry_kpi_idx").on(t.kpiId),
  index("kpi_entry_team_idx").on(t.teamId),
  index("kpi_entry_period_idx").on(t.kpiId, t.periodDate),
]);

/**
 * performance_review
 * Manager reviews an HR team member's performance over a cycle.
 * cycle: "Q1 2024" | "H1 2024" | "Annual 2024"
 * scores: { "candidate_quality": 4, "pipeline_speed": 3, "client_feedback": 5 }
 */
export const performanceReview = pgTable("performance_review", {
  id:           pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:       uuid("team_id").notNull().references(() => team.id),
  reviewerId:   uuid("reviewer_id").notNull().references(() => user.id),
  revieweeId:   uuid("reviewee_id").notNull().references(() => user.id),

  cycle:        text("cycle").notNull(),
  status:       reviewStatusEnum("status").notNull().default("draft"),

  scores:       jsonb("scores").default(sql`'{}'::jsonb`),
  summary:      text("summary"),
  managerNotes: text("manager_notes"),
  // Private notes not visible to reviewee

  submittedAt:  timestamp("submitted_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("pr_team_idx").on(t.teamId),
  index("pr_reviewee_idx").on(t.revieweeId),
]);

/**
 * goal
 * Individual or team goals tracked over time.
 * created_by = manager set it / user set it themselves
 * progress_pct: 0-100, updated manually or via KPI entries
 */
export const goal = pgTable("goal", {
  id:           pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:       uuid("team_id").notNull().references(() => team.id),
  assignedTo:   uuid("assigned_to").references(() => user.id, { onDelete: "set null" }),
  createdBy:    uuid("created_by").notNull().references(() => user.id),

  title:        text("title").notNull(),
  description:  text("description"),
  status:       goalStatusEnum("status").notNull().default("active"),
  progressPct:  integer("progress_pct").notNull().default(0),

  dueDate:      date("due_date"),
  completedAt:  timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("goal_team_idx").on(t.teamId),
  index("goal_assigned_idx").on(t.assignedTo),
]);

/**
 * team_strategy
 * Manager-authored strategy doc for a period.
 * objectives: OKR-style jsonb array
 * [
 *   {
 *     "objective": "Double placement rate",
 *     "key_results": [
 *       { "kr": "Place 40 candidates in Q2", "target": 40, "current": 12 },
 *       { "kr": "Reduce avg time-to-offer to 18 days", "target": 18, "current": 24 }
 *     ]
 *   }
 * ]
 */
export const teamStrategy = pgTable("team_strategy", {
  id:           pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:       uuid("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
  createdBy:    uuid("created_by").notNull().references(() => user.id),

  title:        text("title").notNull(),
  period:       text("period").notNull(),
  // e.g. "Q2 2024" | "H2 2024" | "FY2025"

  description:  text("description"),
  objectives:   jsonb("objectives").notNull().default(sql`'[]'::jsonb`),
  status:       strategyStatusEnum("status").notNull().default("draft"),

  ...timestamps,
}, (t) => [
  index("strategy_team_idx").on(t.teamId),
]);
