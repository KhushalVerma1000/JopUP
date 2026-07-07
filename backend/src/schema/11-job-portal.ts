/**
 * MODULE 11 — JOB PORTAL (Future Integration)
 * module_key: "job_portal"
 *
 * The public-facing job seeker side. Lives OUTSIDE the tenant model —
 * job seekers are not organisation users. They have their own auth,
 * their own profiles, and they interact with published job_postings.
 *
 * When a job seeker applies:
 *   1. portal_application row is created
 *   2. event_log entry: "portal_application.submitted"
 *   3. Background worker picks this up
 *   4. Creates a candidate row (if not existing) in the org's candidate DB
 *   5. Creates an application row linked to the candidate + job posting
 *   6. HR sees the application in their pipeline dashboard
 *
 * Tables:
 *   job_seeker            — public user (no organisation_id)
 *   portal_application    — raw inbound application before HR processes it
 *
 * Key design decisions:
 *   - job_seeker is intentionally separate from user table.
 *     They don't belong to an org; they're applicants to many orgs.
 *   - portal_application is a staging table — once the background worker
 *     processes it (creates candidate + application), processed=true.
 *   - This separation means the job portal can be a completely separate
 *     service/domain that only writes to these two tables.
 *   - Deduplication: if a job seeker applies and a candidate record already
 *     exists for their email in that org, the worker links to the existing
 *     candidate rather than creating a duplicate.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, timestamps, createdAt } from "./_helpers";
import { jobPosting } from "./05-job-postings";

// ─── Enums ───────────────────────────────────

export const jobSeekerStatusEnum = pgEnum("job_seeker_status", [
  "active",
  "inactive",
  "banned",
]);

export const portalApplicationStatusEnum = pgEnum("portal_application_status", [
  "submitted",    // raw inbound, not yet processed
  "processing",   // worker picked it up
  "processed",    // candidate + application rows created
  "failed",       // worker failed — needs retry or manual fix
  "duplicate",    // same person applied twice to same posting
]);

// ─── Tables ──────────────────────────────────

/**
 * job_seeker
 * Public user account. Not scoped to any organisation.
 * Can apply to jobs across multiple organisations.
 */
export const jobSeeker = pgTable("job_seeker", {
  id:           pkUuid(),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  firstName:    text("first_name").notNull(),
  lastName:     text("last_name").notNull(),
  phone:        text("phone"),
  location:     text("location"),
  resumeUrl:    text("resume_url"),
  linkedinUrl:  text("linkedin_url"),
  skills:       jsonb("skills").notNull().default(sql`'[]'::jsonb`),
  status:       jobSeekerStatusEnum("status").notNull().default("active"),
  ...timestamps,
}, (t) => [
  index("js_email_idx").on(t.email),
]);

/**
 * portal_application
 * Raw inbound application from the job portal.
 * Staging table — processed by background worker into candidate + application.
 *
 * processed_candidate_id: set by worker when candidate row is created/matched
 * processed_application_id: set by worker when application row is created
 */
export const portalApplication = pgTable("portal_application", {
  id:                       pkUuid(),
  jobPostingId:             uuid("job_posting_id").notNull()
                              .references(() => jobPosting.id),
  jobSeekerId:              uuid("job_seeker_id").notNull()
                              .references(() => jobSeeker.id),

  coverLetter:              text("cover_letter"),
  resumeUrl:                text("resume_url"),
  // Snapshot of resume at time of application

  status:                   portalApplicationStatusEnum("status")
                              .notNull().default("submitted"),
  processedCandidateId:     uuid("processed_candidate_id"),
  processedApplicationId:   uuid("processed_application_id"),
  processingError:          text("processing_error"),
  processedAt:              timestamp("processed_at", { withTimezone: true }),

  ...createdAt,
}, (t) => [
  index("pa_job_idx").on(t.jobPostingId),
  index("pa_seeker_idx").on(t.jobSeekerId),
  index("pa_status_idx").on(t.status),
  // Prevent duplicate applications to same posting
  uniqueIndex("pa_unique_application_idx").on(t.jobPostingId, t.jobSeekerId),
]);
