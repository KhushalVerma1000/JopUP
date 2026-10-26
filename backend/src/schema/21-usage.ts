/**
 * MODULE 21 — USAGE COUNTERS
 *
 * Generic per-organisation, per-period counters for free-but-metered actions
 * (e.g. resume parsing: free, capped per month during a trial). Credits are for
 * paid actions; this is for allowances.
 *
 * One row per (organisation, key, period_start). Writers use a single atomic
 * upsert that only increments while the new total stays within the cap, so
 * parallel requests cannot overshoot it.
 */
import { pgTable, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pkUuid, orgId } from "./_helpers";
import { organisation } from "./02-identity";

export const usageCounter = pgTable("usage_counter", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  key:            text("key").notNull(),
  periodStart:    timestamp("period_start", { withTimezone: true }).notNull(),
  count:          integer("count").notNull().default(0),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("usage_counter_unique_idx").on(t.organisationId, t.key, t.periodStart),
  index("usage_counter_org_idx").on(t.organisationId),
]);
