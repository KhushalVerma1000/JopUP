/**
 * MODULE 3 — CLIENT MANAGEMENT
 * module_key: "client_management"
 *
 * Clients are companies that teams hire for (the end-customers of the
 * recruitment service). They are NOT users — they don't log in.
 *
 * Tables:
 *   client              — company record owned by a team
 *   client_team_access  — cross-team sharing grants (org admin can share
 *                         a client from Team A to Team B)
 *
 * Key design decisions:
 *   - Every client has a primary owner_team_id
 *   - Org admin can share any client org-wide (shared_org_wide = true)
 *     or grant specific team access via client_team_access
 *   - Managers CRUD their own team's clients
 *   - custom_fields jsonb lets each team track extra data without migrations
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";

// ─── Enums ───────────────────────────────────

export const clientStatusEnum = pgEnum("client_status", [
  "active",
  "inactive",
  "prospect",
  "on_hold",
]);

// ─── Tables ──────────────────────────────────

/**
 * client
 * A company that the HR team is recruiting for.
 * owner_team_id = primary owning team (managers of this team control it).
 * shared_org_wide = visible to all teams in the org (set by org admin).
 */
export const client = pgTable("client", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  ownerTeamId:    uuid("owner_team_id").notNull().references(() => team.id),
  createdBy:      uuid("created_by").notNull().references(() => user.id),
  updatedBy:      uuid("updated_by").references(() => user.id),

  companyName:    text("company_name").notNull(),
  industry:       text("industry"),
  website:        text("website"),

  // Primary contact at the client company
  contactName:    text("contact_name"),
  contactEmail:   text("contact_email"),
  contactPhone:   text("contact_phone"),
  contactRole:    text("contact_role"),

  address:        jsonb("address"),
  // { line1, line2, city, state, country, postcode }

  status:         clientStatusEnum("status").notNull().default("active"),
  notes:          text("notes"),

  // When true, all teams in the org can see and use this client
  sharedOrgWide:  boolean("shared_org_wide").notNull().default(false),

  // Team-specific extra fields (e.g. "account manager", "SLA tier")
  customFields:   jsonb("custom_fields").default(sql`'{}'::jsonb`),

  ...timestamps,
}, (t) => [
  index("client_org_idx").on(t.organisationId),
  index("client_team_idx").on(t.ownerTeamId),
  index("client_status_idx").on(t.status),
]);

/**
 * client_team_access
 * Explicit cross-team sharing record.
 * Created by org admin when they grant Team B access to a client
 * that belongs to Team A. Read-only access by default.
 */
export const clientTeamAccess = pgTable("client_team_access", {
  id:          pkUuid(),
  clientId:    uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  teamId:      uuid("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
  grantedBy:   uuid("granted_by").notNull().references(() => user.id),
  canWrite:    boolean("can_write").notNull().default(false),
  ...createdAt,
}, (t) => [
  index("cta_client_idx").on(t.clientId),
  index("cta_team_idx").on(t.teamId),
]);
