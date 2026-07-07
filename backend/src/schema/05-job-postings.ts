/**
 * MODULE 5 — JOB POSTINGS
 * module_key: "job_posting"
 *
 * HR-created job listings. Each posting belongs to a team and
 * optionally references a client (the company being hired for).
 * Published postings are accessible via the job portal (future integration).
 *
 * Tables:
 *   job_posting   — the listing itself
 *
 * Key design decisions:
 *   - client_id is optional — some roles may be internal hires
 *   - required_skills is a jsonb string[] used for candidate matching
 *   - status flow: draft → published → closed | archived
 *   - posting is linked to a workflow_template_id so every application
 *     from this posting follows the correct pipeline automatically
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, orgId, timestamps } from "./_helpers";
import { organisation, team, user } from "./02-identity";
import { client } from "./03-clients";

// ─── Enums ───────────────────────────────────

export const jobStatusEnum = pgEnum("job_status", [
  "draft",
  "published",
  "paused",
  "closed",
  "archived",
]);

export const workModeEnum = pgEnum("work_mode", [
  "onsite",
  "remote",
  "hybrid",
]);

export const employmentTypeEnum = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "temporary",
  "internship",
]);

// ─── Tables ──────────────────────────────────

/**
 * job_posting
 * A published vacancy. The link between team demand and candidate supply.
 *
 * workflow_template_id — every application to this posting will automatically
 * use this workflow. Set by HR at creation time. Can be null if the org uses
 * the default team workflow.
 */
export const jobPosting = pgTable("job_posting", {
  id:                   pkUuid(),
  organisationId:       orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:               uuid("team_id").notNull().references(() => team.id),
  clientId:             uuid("client_id").references(() => client.id, { onDelete: "set null" }),
  createdBy:            uuid("created_by").notNull().references(() => user.id),

  // Workflow template applied to all applications from this posting
  // NULL = use team default (resolved at application creation time)
  workflowTemplateId:   uuid("workflow_template_id"),

  title:                text("title").notNull(),
  description:          text("description").notNull(),
  requirements:         text("requirements"),
  benefits:             text("benefits"),

  location:             text("location"),
  workMode:             workModeEnum("work_mode").notNull().default("onsite"),
  employmentType:       employmentTypeEnum("employment_type").notNull().default("full_time"),

  // Salary range (stored as text to allow "Negotiable", "₹8-12 LPA" etc.)
  salaryMin:            text("salary_min"),
  salaryMax:            text("salary_max"),
  salaryCurrency:       text("salary_currency").default("INR"),

  // Skills required — string[] for filtering/matching
  requiredSkills:       jsonb("required_skills").notNull().default(sql`'[]'::jsonb`),

  vacancies:            integer("vacancies").notNull().default(1),
  status:               jobStatusEnum("status").notNull().default("draft"),

  publishedAt:          timestamp("published_at", { withTimezone: true }),
  closesAt:             timestamp("closes_at", { withTimezone: true }),

  // Portal-specific SEO/distribution metadata
  externalRef:          text("external_ref"),
  // e.g. naukri.com posting ID, LinkedIn job ID

  ...timestamps,
}, (t) => [
  index("job_org_idx").on(t.organisationId),
  index("job_team_idx").on(t.teamId),
  index("job_status_idx").on(t.status),
  index("job_client_idx").on(t.clientId),
]);
