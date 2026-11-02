/**
 * MODULE 22 - TRIAL SELECTIONS
 *
 * Companies a platform admin has pre-selected for the 90-day trial, before they
 * sign up. `email` holds either a full address ("hr@acme.com") or a company
 * domain written "@acme.com". At signup the first matching, unclaimed row
 * upgrades the new workspace to the extended trial and is marked claimed.
 */
import { pgTable, text, uuid, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pkUuid } from "./_helpers";
import { organisation } from "./02-identity";

export const trialSelection = pgTable("trial_selection", {
  id:           pkUuid(),
  match:        text("match").notNull(),
  note:         text("note"),
  createdBy:    uuid("created_by"),
  claimedOrgId: uuid("claimed_org_id").references(() => organisation.id, { onDelete: "set null" }),
  claimedAt:    timestamp("claimed_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("trial_selection_match_idx").on(t.match),
  index("trial_selection_claimed_idx").on(t.claimedOrgId),
]);
