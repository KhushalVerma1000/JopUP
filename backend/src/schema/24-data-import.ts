/**
 * 24 · Data import
 *
 * A batch is one uploaded spreadsheet taken as far as a reviewed plan: what
 * would be created, matched and skipped. Nothing here touches the real tables;
 * committing a batch is a separate step. Rows hold normalised values only (not
 * the raw cells), and a batch is purged at `expires_at` because it contains
 * candidate personal data.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pkUuid, orgId, timestamps } from "./_helpers";
import { organisation, team, user } from "./02-identity";

export const importBatchStatusEnum = pgEnum("import_batch_status", [
  "previewed",  // analysed and matched; waiting for HR to review and confirm
  "importing",  // commit in progress (resumable)
  "done",
  "failed",
  "undone",
]);

export const importRowStatusEnum = pgEnum("import_row_status", [
  "pending",
  "done",
  "skipped",
  "failed",
]);

export const importBatch = pgTable("import_batch", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").notNull().references(() => team.id),
  createdBy:      uuid("created_by").notNull().references(() => user.id),
  fileName:       text("file_name").notNull(),
  fileHash:       text("file_hash").notNull(),
  status:         importBatchStatusEnum("status").notNull().default("previewed"),
  /** What the analysis was run with: country, date order, status words, column choices. */
  options:        jsonb("options").notNull().default(sql`'{}'::jsonb`),
  /** HR's answers on entities: which client/location/position/recruiter/candidate rows use. */
  decisions:      jsonb("decisions").notNull().default(sql`'{}'::jsonb`),
  /** The matched entities (clients, locations, positions, recruiters). */
  entities:       jsonb("entities").notNull().default(sql`'{}'::jsonb`),
  summary:        jsonb("summary").notNull().default(sql`'{}'::jsonb`),
  expiresAt:      timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (t) => [
  index("ib_org_idx").on(t.organisationId),
  index("ib_team_idx").on(t.teamId),
  index("ib_expires_idx").on(t.expiresAt),
]);

export const importRow = pgTable("import_row", {
  id:         pkUuid(),
  batchId:    uuid("batch_id").notNull().references(() => importBatch.id, { onDelete: "cascade" }),
  /** Position in the file, across sheets: the commit order. */
  seq:        integer("seq").notNull(),
  sheetName:  text("sheet_name").notNull(),
  rowNumber:  integer("row_number").notNull(),
  /** The normalised record from the analyser: { candidate, tracker, custom }. */
  data:       jsonb("data").notNull(),
  issues:     jsonb("issues").notNull().default(sql`'[]'::jsonb`),
  /** What this row would do: refs into the batch entities, candidate and tracker actions. */
  plan:       jsonb("plan").notNull().default(sql`'{}'::jsonb`),
  status:     importRowStatusEnum("status").notNull().default("pending"),
  /** Filled in by the commit: ids of what was created or matched. */
  result:     jsonb("result"),
  error:      text("error"),
}, (t) => [
  uniqueIndex("ir_batch_seq_uq").on(t.batchId, t.seq),
  index("ir_batch_status_idx").on(t.batchId, t.status),
]);
