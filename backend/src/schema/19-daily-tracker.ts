/**
 * MODULE 19 — DAILY TRACKER (scheduled client tracker mails)
 *
 * A daily tracker is the live pipeline (module 18) frozen into module 16's
 * `tracker` snapshot and emailed through module 16's `email_message`. This
 * module only adds the two things those tables don't have: WHEN to send and
 * WHAT HAPPENED each time.
 *
 *   daily_tracker_schedule — one per (team, client): send time, timezone, days,
 *                            extra recipients. client_id NULL = the team's
 *                            internal digest (positions with no client).
 *                            enabled=false is a valid "manual sends only" state.
 *   daily_tracker_run      — one row per attempt (scheduled or manual). The
 *                            partial unique index below is what stops two
 *                            servers, or one server on two ticks, from sending
 *                            the same day's tracker twice.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, boolean, integer, timestamp, jsonb, date, pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";
import { client } from "./03-clients";
import { tracker, emailMessage } from "./16-client-communications";

export const dailyTrackerTriggerEnum = pgEnum("daily_tracker_trigger", ["scheduled", "manual"]);

export const dailyTrackerRunStatusEnum = pgEnum("daily_tracker_run_status", [
  "running",   // claimed, in progress (a run stuck here is failed by the scheduler)
  "sent",
  "skipped",   // nothing to report and skip_if_empty was on
  "failed",
]);

export const dailyTrackerSchedule = pgTable("daily_tracker_schedule", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
  clientId:       uuid("client_id").references(() => client.id, { onDelete: "cascade" }),
  createdBy:      uuid("created_by").notNull().references(() => user.id),

  enabled:        boolean("enabled").notNull().default(true),
  // Local wall-clock "HH:MM" in `timezone` (or the organisation's timezone when null).
  sendTime:       text("send_time").notNull().default("18:00"),
  timezone:       text("timezone"),
  // ISO weekdays, Mon=1 … Sun=7. Default Mon–Sat.
  sendDays:       jsonb("send_days").notNull().default(sql`'[1,2,3,4,5,6]'::jsonb`),
  skipIfEmpty:    boolean("skip_if_empty").notNull().default(true),

  toEmails:       jsonb("to_emails").notNull().default(sql`'[]'::jsonb`),
  ccEmails:       jsonb("cc_emails").notNull().default(sql`'[]'::jsonb`),
  // Also include the client's SPOCs flagged receives_trackers_by_default (To)
  // and our default-cc internal contacts for the client (Cc).
  includeClientContacts: boolean("include_client_contacts").notNull().default(true),

  ...timestamps,
}, (t) => [
  index("dts_org_idx").on(t.organisationId),
  index("dts_team_idx").on(t.teamId),
  index("dts_due_idx").on(t.enabled),
  uniqueIndex("dts_one_per_team_client").on(t.teamId, t.clientId).where(sql`${t.clientId} is not null`),
  uniqueIndex("dts_one_internal_per_team").on(t.teamId).where(sql`${t.clientId} is null`),
]);

export const dailyTrackerRun = pgTable("daily_tracker_run", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  scheduleId:     uuid("schedule_id").notNull().references(() => dailyTrackerSchedule.id, { onDelete: "cascade" }),
  // The LOCAL calendar date this tracker reports on (schedule timezone).
  trackerDate:    date("tracker_date", { mode: "string" }).notNull(),
  trigger:        dailyTrackerTriggerEnum("trigger").notNull(),
  status:         dailyTrackerRunStatusEnum("status").notNull().default("running"),

  trackerId:      uuid("tracker_id").references(() => tracker.id, { onDelete: "set null" }),
  emailMessageId: uuid("email_message_id").references(() => emailMessage.id, { onDelete: "set null" }),
  rowCount:       integer("row_count").notNull().default(0),
  recipientCount: integer("recipient_count").notNull().default(0),
  error:          text("error"),
  triggeredBy:    uuid("triggered_by").references(() => user.id, { onDelete: "set null" }),

  startedAt:      timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
  finishedAt:     timestamp("finished_at", { withTimezone: true }),
  ...createdAt,
}, (t) => [
  index("dtr_schedule_date_idx").on(t.scheduleId, t.trackerDate),
  index("dtr_org_idx").on(t.organisationId),
  // One non-failed SCHEDULED run per schedule per day. A failed run frees the
  // slot so the scheduler can retry; manual runs are never limited.
  uniqueIndex("dtr_one_scheduled_per_day").on(t.scheduleId, t.trackerDate)
    .where(sql`${t.trigger} = 'scheduled' and ${t.status} <> 'failed'`),
]);
