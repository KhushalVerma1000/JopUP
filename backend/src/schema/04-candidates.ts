/**
 * MODULE 4 — CANDIDATE DATABASE
 * module_key: "candidate_db"
 *
 * The organisation-wide talent pool. Partitioned by team ownership
 * but shareable across teams within the org. Completely isolated
 * from other organisations — no candidate record is ever visible
 * across org boundaries.
 *
 * Candidates enter via three routes (all land in same table):
 *   1. job_post     — applied through a published job posting
 *   2. manual       — HR created the record directly
 *   3. resume_upload — HR uploaded a CV, parsed into a candidate record
 *
 * Tables:
 *   candidate              — core talent record
 *   candidate_team_access  — cross-team sharing grants
 *
 * Key design decisions:
 *   - source + source_ref links back to the originating job_posting_id
 *     or document_id so the entry route is always traceable
 *   - parsed_resume is the raw jsonb output from the resume parser
 *   - skills is a normalised string[] extracted from the resume/HR entry
 *   - custom_fields for org-specific fields (notice period, agency name, etc.)
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";

// ─── Enums ───────────────────────────────────

export const candidateSourceEnum = pgEnum("candidate_source", [
  "job_post",
  "manual",
  "resume_upload",
  "referral",
  "agency",
  "linkedin",
  "other",
]);

export const candidateStatusEnum = pgEnum("candidate_status", [
  "active",       // in pipeline or available
  "placed",       // successfully joined a role
  "blacklisted",  // do not engage
  "archived",     // no longer relevant
]);

// ─── Tables ──────────────────────────────────

/**
 * candidate
 * The canonical talent record for this organisation.
 * There should never be two candidate rows for the same person
 * in the same org — HR should check before creating.
 *
 * owner_team_id = the team that created/owns the record.
 * Other teams can be granted access via candidate_team_access.
 */
export const candidate = pgTable("candidate", {
  id:              pkUuid(),
  organisationId:  orgId().references(() => organisation.id, { onDelete: "cascade" }),
  ownerTeamId:     uuid("owner_team_id").notNull().references(() => team.id),
  createdBy:       uuid("created_by").notNull().references(() => user.id),
  updatedBy:       uuid("updated_by").references(() => user.id),

  // Core identity
  firstName:       text("first_name").notNull(),
  lastName:        text("last_name").notNull(),
  email:           text("email"),
  phone:           text("phone"),
  location:        text("location"),
  linkedinUrl:     text("linkedin_url"),

  // Entry route
  source:          candidateSourceEnum("source").notNull(),
  sourceRef:       text("source_ref"),
  // For job_post: job_posting.id
  // For resume_upload: document.id
  // For agency/referral: free text name

  // Resume data
  resumeUrl:       text("resume_url"),
  parsedResume:    jsonb("parsed_resume"),
  // Raw output from resume parser:
  // { work_experience: [], education: [], summary: "", raw_text: "" }

  // Normalised skills array for filtering/matching
  skills:          jsonb("skills").notNull().default(sql`'[]'::jsonb`),

  // Profile notes from HR
  notes:           text("notes"),

  status:          candidateStatusEnum("status").notNull().default("active"),
  customFields:    jsonb("custom_fields").default(sql`'{}'::jsonb`),

  // Prevent duplicate candidate records for same email in same org
  ...timestamps,
}, (t) => [
  index("candidate_org_idx").on(t.organisationId),
  index("candidate_team_idx").on(t.ownerTeamId),
  index("candidate_status_idx").on(t.status),
  index("candidate_email_org_idx").on(t.organisationId, t.email),
]);

/**
 * candidate_team_access
 * Explicit cross-team access grant for a candidate record.
 * Granted by org admin or by the owner team's manager.
 * can_write = true allows the accessing team to edit the record.
 */
export const candidateTeamAccess = pgTable("candidate_team_access", {
  id:           pkUuid(),
  candidateId:  uuid("candidate_id").notNull().references(() => candidate.id, { onDelete: "cascade" }),
  teamId:       uuid("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
  grantedBy:    uuid("granted_by").notNull().references(() => user.id),
  canWrite:     boolean("can_write").notNull().default(false),
  ...createdAt,
}, (t) => [
  index("cand_access_candidate_idx").on(t.candidateId),
  index("cand_access_team_idx").on(t.teamId),
  uniqueIndex("cand_access_unique_idx").on(t.candidateId, t.teamId),
]);
