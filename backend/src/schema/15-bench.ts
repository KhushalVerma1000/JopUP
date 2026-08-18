/**
 * MODULE 15 — BENCH SALES (BenchPro)
 * module_key: "bench_sales"
 * depends_on: ["candidate_db"]
 *
 * Manages "bench" candidates — consultants/contractors between
 * assignments who need to be marketed to prospective clients — and the
 * prospect pipeline used to convert them from bench to billable.
 *
 * Tables:
 *   bench_profile    — marks a candidate as bench-available + bench metadata
 *   bench_prospect    — a target client opportunity for a bench profile
 *   bench_activity_log — calls, submissions, emails logged against either
 *
 * Key design decisions:
 *   - bench_profile does NOT duplicate candidate data — it's a 1:1
 *     extension of `candidate` (module 04) adding bench-specific fields
 *     (rate, availability, heat) the way employee_profile extends `user`.
 *   - heat_tag gives the "Hot / Warm / New" triage UI from the Vybog Tal
 *     BenchPro module a first-class column instead of a computed value,
 *     since it's manually set by the bench recruiter, not derived.
 *   - bench_prospect is intentionally separate from `client` — most
 *     prospects never convert, and client rows carry ongoing-relationship
 *     weight (invoices, teams, shared access) that a cold prospect
 *     shouldn't need until it's actually won.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";
import { candidate } from "./04-candidates";

// ─── Enums ───────────────────────────────────

export const benchAvailabilityEnum = pgEnum("bench_availability", [
  "available",
  "engaged",       // currently placed but open to future opportunities
  "not_available",
]);

export const benchHeatEnum = pgEnum("bench_heat", [
  "hot",
  "warm",
  "new",
  "cold",
]);

export const benchProspectStatusEnum = pgEnum("bench_prospect_status", [
  "new",
  "contacted",
  "qualified",
  "submitted",
  "interviewing",
  "won",
  "lost",
]);

export const benchActivityTypeEnum = pgEnum("bench_activity_type", [
  "call",
  "email",
  "submission",
  "note",
  "status_changed",
]);

// ─── Tables ──────────────────────────────────

/**
 * bench_profile
 * 1:1 extension of `candidate` marking them bench-available and
 * carrying bench-specific marketing data.
 */
export const benchProfile = pgTable("bench_profile", {
  id:               pkUuid(),
  organisationId:   orgId().references(() => organisation.id, { onDelete: "cascade" }),
  candidateId:      uuid("candidate_id").notNull().references(() => candidate.id, { onDelete: "cascade" }),
  ownerTeamId:      uuid("owner_team_id").notNull().references(() => team.id),

  availability:     benchAvailabilityEnum("availability").notNull().default("available"),
  heatTag:          benchHeatEnum("heat_tag").notNull().default("new"),

  rateExpectation:  text("rate_expectation"),
  // Free text: "$65/hr", "Negotiable"
  availableFrom:    date("available_from"),
  yearsExperience:  text("years_experience"),

  marketingSkills:  jsonb("marketing_skills").notNull().default(sql`'[]'::jsonb`),
  // Curated skill highlights for pitching — may differ from candidate.skills

  notes:            text("notes"),
  customFields:     jsonb("custom_fields").default(sql`'{}'::jsonb`),

  ...timestamps,
}, (t) => [
  uniqueIndex("bench_profile_candidate_idx").on(t.candidateId),
  index("bench_profile_org_idx").on(t.organisationId),
  index("bench_profile_team_idx").on(t.ownerTeamId),
  index("bench_profile_availability_idx").on(t.availability),
  index("bench_profile_heat_idx").on(t.heatTag),
]);

/**
 * bench_prospect
 * A target client opportunity for marketing a bench profile.
 * The "curated prospect database" — bench-to-billable pipeline.
 */
export const benchProspect = pgTable("bench_prospect", {
  id:              pkUuid(),
  organisationId:  orgId().references(() => organisation.id, { onDelete: "cascade" }),
  benchProfileId:  uuid("bench_profile_id").notNull().references(() => benchProfile.id, { onDelete: "cascade" }),
  assignedTo:      uuid("assigned_to").references(() => user.id, { onDelete: "set null" }),
  createdBy:       uuid("created_by").notNull().references(() => user.id),

  prospectCompany: text("prospect_company").notNull(),
  contactName:     text("contact_name"),
  contactEmail:    text("contact_email"),
  contactPhone:    text("contact_phone"),

  status:          benchProspectStatusEnum("status").notNull().default("new"),
  rateOffered:     text("rate_offered"),
  notes:           text("notes"),

  ...timestamps,
}, (t) => [
  index("bp_org_idx").on(t.organisationId),
  index("bp_profile_idx").on(t.benchProfileId),
  index("bp_status_idx").on(t.status),
  index("bp_assigned_idx").on(t.assignedTo),
]);

/**
 * bench_activity_log
 * Every call, email, or submission logged against a bench profile or
 * a specific prospect opportunity. entity_id + entity_type keep this
 * table generic rather than forking into two near-identical tables.
 */
export const benchActivityLog = pgTable("bench_activity_log", {
  id:            pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  entityType:    text("entity_type").notNull(),
  // "bench_profile" | "bench_prospect"
  entityId:      uuid("entity_id").notNull(),

  performedBy:   uuid("performed_by").notNull().references(() => user.id),
  activityType:  benchActivityTypeEnum("activity_type").notNull(),
  content:       text("content"),
  metadata:      jsonb("metadata").default(sql`'{}'::jsonb`),

  performedAt:   timestamp("performed_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => [
  index("bal_org_idx").on(t.organisationId),
  index("bal_entity_idx").on(t.entityType, t.entityId),
]);
