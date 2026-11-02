/**
 * MODULE 23 - PLAN REQUESTS
 *
 * Someone asking for a plan we do not hand out self-serve: an Enterprise trial
 * (requested by email form) or an upgrade to Pro. Saved first, then emailed to
 * sales, so a failed email never loses a lead. A platform admin approves an
 * Enterprise request (which switches the matching workspace onto an Enterprise
 * trial) or marks a Pro request contacted.
 *
 * status: pending | approved | declined | contacted
 */
import { pgTable, text, uuid, integer, timestamp, index } from "drizzle-orm/pg-core";
import { pkUuid } from "./_helpers";
import { organisation } from "./02-identity";

export const trialRequest = pgTable("trial_request", {
  id:             pkUuid(),
  requestedPlan:  text("requested_plan").notNull().default("enterprise"),
  name:           text("name").notNull(),
  email:          text("email").notNull(),
  company:        text("company").notNull(),
  phone:          text("phone"),
  teamSize:       text("team_size"),
  message:        text("message"),
  status:         text("status").notNull().default("pending"),
  organisationId: uuid("organisation_id").references(() => organisation.id, { onDelete: "set null" }),
  trialDays:      integer("trial_days"),
  decisionNote:   text("decision_note"),
  handledBy:      uuid("handled_by"),
  handledAt:      timestamp("handled_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("trial_request_status_idx").on(t.status, t.createdAt),
  index("trial_request_email_idx").on(t.email),
]);
