/**
 * SCHEMA HELPERS
 *
 * Shared Drizzle column builders used across all schema modules.
 * Import these instead of repeating the same column definitions everywhere.
 */

import { uuid, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { v7 as uuidv7 } from "uuid";

/**
 * pkUuid — standard primary key column
 * Uses UUID v7 generated in the application layer for time-sorted UUIDs.
 * This is better for database indexing and pagination than UUID v4.
 */
export const pkUuid = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * orgId — reusable organisation_id column builder
 * Returns a uuid column named "organisation_id".
 * Add .references() at the call site to point to the org table.
 */
export const orgId = () => uuid("organisation_id").notNull();

/**
 * timestamps — created_at + updated_at columns
 * updated_at is automatically set to now() on every update via a trigger
 * (add the trigger in your migration file).
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
};

/**
 * createdAt — just the created_at column (for append-only tables)
 */
export const createdAt = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
};
