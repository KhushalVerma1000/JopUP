/**
 * MODULE 17 — OPEN POSITIONS
 * module_key: "job_posting" (gated the same as module 5 — see seed.ts note)
 *
 * A requisition: a real (or ad-hoc) need to fill N seats, for a client
 * or internally. This is the root of hiring demand — a job_posting is
 * just one advertised *channel* for one of these (LinkedIn, an internal
 * portal, a future external site can each be their own job_posting row,
 * all pointing at one open_position); a candidate_tracker entry is what
 * actually counts against it.
 *
 * Tables:
 *   open_position — the requisition itself
 *
 * Key design decisions:
 *   - client_id is nullable — null means an internal hire, not a mistake
 *   - a position does not require a job_posting to exist first (HR can
 *     start tracking candidates against it immediately) and a job_posting
 *     does not require a position to exist first (see 05-job-postings.ts) —
 *     both directions are optional by design, not a migration artifact
 *   - vacancies is the target headcount; how many are actually filled is
 *     derived by counting candidate_tracker rows with status = 'placed'
 *     for this position, never stored here (same "derive, don't cache"
 *     rule as current-stage in the pipeline tracker)
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps } from "./_helpers";
import { organisation, team, user } from "./02-identity";
import { client } from "./03-clients";

// ─── Enums ───────────────────────────────────

export const openPositionStatusEnum = pgEnum("open_position_status", [
  "open",       // actively being filled
  "on_hold",    // paused, not cancelled
  "filled",     // vacancies met
  "cancelled",  // requisition withdrawn
]);

// ─── Tables ──────────────────────────────────

/**
 * open_position
 * A requisition to fill `vacancies` seats of `designation`, for a client
 * (or internally, when client_id is null).
 */
export const openPosition = pgTable("open_position", {
  id:                   pkUuid(),
  organisationId:       orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:               uuid("team_id").notNull().references(() => team.id),
  // NULL = internal hire, not a mistake — see module docstring.
  clientId:             uuid("client_id").references(() => client.id, { onDelete: "set null" }),
  createdBy:            uuid("created_by").notNull().references(() => user.id),

  designation:          text("designation").notNull(),
  location:             text("location"),
  experienceRequired:   text("experience_required"),
  // Free text ("2-4 years", "Fresher") — mirrors job_posting's salary
  // fields, which use the same free-text approach for the same reason.

  vacancies:            integer("vacancies").notNull().default(1),
  status:               openPositionStatusEnum("status").notNull().default("open"),

  notes:                text("notes"),

  ...timestamps,
}, (t) => [
  index("op_org_idx").on(t.organisationId),
  index("op_team_idx").on(t.teamId),
  index("op_client_idx").on(t.clientId),
  index("op_status_idx").on(t.status),
]);
