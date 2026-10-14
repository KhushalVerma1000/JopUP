/**
 * MODULE 20 — PIPELINE AUTOMATION RULES
 * module_key: "pipeline_tracker"
 *
 * "When X happens, move the candidate to stage Y." A rule has one trigger and
 * one target stage, and the engine only ever moves a candidate FORWARD along
 * their own workflow (same guard as a manual advance), never backwards, and
 * never for a candidate who is held / rejected / withdrawn / placed.
 *
 *   trigger = 'date_set'  → trigger_key is 'lineupDate' | 'interviewDate'
 *   trigger = 'mail_sent' → trigger_key is a mail type ('lineup', 'offer', …)
 *
 * target_stage_key is a workflow_stage.stage_key (not an id) so one rule works
 * for every team's own workflow template. One rule per (org, trigger, key).
 */

import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps } from "./_helpers";
import { organisation, user } from "./02-identity";

export const automationRule = pgTable("automation_rule", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  name:           text("name").notNull(),
  trigger:        text("trigger").notNull(),
  triggerKey:     text("trigger_key").notNull(),
  targetStageKey: text("target_stage_key").notNull(),
  isEnabled:      boolean("is_enabled").notNull().default(true),
  createdBy:      uuid("created_by").references(() => user.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  index("ar_org_idx").on(t.organisationId),
  uniqueIndex("ar_one_per_trigger").on(t.organisationId, t.trigger, t.triggerKey),
]);
