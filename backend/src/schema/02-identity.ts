/**
 * MODULE 2 — IDENTITY & ACCESS
 *
 * Core tenant structure. Every other module depends on these tables.
 * This is the only place foreign keys from other modules point back to.
 *
 * Tables:
 *   organisation      — top-level tenant (company that bought the platform)
 *   org_module_override — escape valve for per-org module on/off outside plan
 *   user              — single record per person per organisation
 *   role              — named permission sets (platform_admin, org_admin, manager, hr)
 *   user_team_role    — the join table that places a user in a team with a role
 *   invitation        — pending onboarding tokens
 *   team              — groups within an org (each has its own HR staff + pipeline)
 *
 * Key design decisions:
 *   - ONE user record per person per org. If Sarah is manager of Team A
 *     and HR in Team B, she has ONE user row + TWO user_team_role rows.
 *   - Roles have a scope field: 'platform' | 'org' | 'team'
 *     Org admin = user_team_role with role.scope='org' and team_id=NULL
 *   - org_module_override lets platform admin enable/disable specific modules
 *     for one org without touching their plan
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
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { plan } from "./01-platform";

// ─── Enums ───────────────────────────────────

export const orgStatusEnum = pgEnum("org_status", [
  "trialing",
  "active",
  "suspended",
  "cancelled",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "inactive",
  "invited",
  "suspended",
]);

export const roleScopeEnum = pgEnum("role_scope", [
  "platform",
  "org",
  "team",
]);

export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);

// ─── Tables ──────────────────────────────────

/**
 * organisation
 * Top-level tenant. Every table in the system carries organisation_id
 * as a non-negotiable tenant isolation key.
 */
export const organisation = pgTable("organisation", {
  id:           pkUuid(),
  planId:       uuid("plan_id").notNull().references(() => plan.id),
  name:         text("name").notNull(),
  slug:         text("slug").notNull().unique(),
  domain:       text("domain"),
  logoUrl:      text("logo_url"),
  status:       orgStatusEnum("status").notNull().default("trialing"),
  trialEndsAt:  timestamp("trial_ends_at", { withTimezone: true }),
  timezone:     text("timezone").default("UTC"),
  ...timestamps,
}, (t) => [
  index("org_plan_idx").on(t.planId),
  index("org_status_idx").on(t.status),
]);

/**
 * org_module_override
 * Per-org escape valve for enabling/disabling specific modules outside plan.
 * Platform admin uses this to grant beta access, trial extensions, suspensions.
 * Application resolves effective modules as: plan.modules + overrides.
 */
export const orgModuleOverride = pgTable("org_module_override", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  moduleKey:      text("module_key").notNull(),
  enabled:        boolean("enabled").notNull(),
  config:         jsonb("config").default(sql`'{}'::jsonb`),
  reason:         text("reason"),
  changedBy:      uuid("changed_by"),           // platform admin user id
  changedAt:      timestamp("changed_at", { withTimezone: true })
                    .notNull()
                    .default(sql`now()`),
}, (t) => [
  uniqueIndex("org_module_unique_idx").on(t.organisationId, t.moduleKey),
]);

/**
 * team
 * Organisational units within a tenant.
 * Each team owns its own clients, candidate pipeline, and HR staff.
 */
export const team = pgTable("team", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  name:           text("name").notNull(),
  description:    text("description"),
  status:         text("status").notNull().default("active"),
  ...timestamps,
}, (t) => [
  index("team_org_idx").on(t.organisationId),
]);

/**
 * user
 * One record per person per organisation. This is the identity anchor
 * for everything in the system. HR, managers, and org admins are all
 * users — their capabilities come from user_team_role, not separate tables.
 */
export const user = pgTable("user", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  email:          text("email").notNull(),
  passwordHash:   text("password_hash"),
  firstName:      text("first_name").notNull(),
  lastName:       text("last_name").notNull(),
  phone:          text("phone"),
  avatarUrl:      text("avatar_url"),
  status:         userStatusEnum("status").notNull().default("invited"),
  lastLoginAt:    timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  // Email must be unique within an org, not globally
  uniqueIndex("user_email_org_idx").on(t.organisationId, t.email),
  index("user_org_idx").on(t.organisationId),
]);

/**
 * role
 * Named permission sets. Seeded at startup — not created by users.
 *
 * Built-in roles:
 *   platform_admin  scope=platform   — full system access
 *   org_admin       scope=org        — full org access, manage teams/users
 *   manager         scope=team       — own team: clients, pipeline, KPIs, strategy
 *   hr              scope=team       — own team: candidates, jobs, workflow actions
 *
 * permissions is a jsonb object:
 *   { "clients": ["read","write","delete"],
 *     "candidates": ["read","write"],
 *     "job_postings": ["read","write","publish"],
 *     "workflow": ["advance","block","hold"],
 *     "kpi": ["read","write"],
 *     "team_members": ["read"] }
 */
export const role = pgTable("role", {
  id:          pkUuid(),
  name:        text("name").notNull().unique(),
  scope:       roleScopeEnum("scope").notNull(),
  description: text("description"),
  permissions: jsonb("permissions").notNull().default(sql`'{}'::jsonb`),
  isSystem:    boolean("is_system").notNull().default(false),
  ...createdAt,
});

/**
 * user_team_role
 * The access control join table. A user gets capabilities by holding
 * a role in a team. One person can hold different roles in different teams.
 *
 * For org_admin: team_id is NULL, role.scope = 'org'
 * For team roles: team_id points to their team, role.scope = 'team'
 * Soft-delete via revokedAt — historical access is preserved for audit.
 */
export const userTeamRole = pgTable("user_team_role", {
  id:          pkUuid(),
  userId:      uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  teamId:      uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
  roleId:      uuid("role_id").notNull().references(() => role.id),
  assignedBy:  uuid("assigned_by").references(() => user.id),
  assignedAt:  timestamp("assigned_at", { withTimezone: true })
                 .notNull().default(sql`now()`),
  revokedAt:   timestamp("revoked_at", { withTimezone: true }),
  revokedBy:   uuid("revoked_by").references(() => user.id),
}, (t) => [
  index("utr_user_idx").on(t.userId),
  index("utr_team_idx").on(t.teamId),
  // Prevent duplicate active roles for same user+team+role
  uniqueIndex("utr_active_unique_idx").on(t.userId, t.teamId, t.roleId),
]);

/**
 * invitation
 * Token-based onboarding. HR/admin sends invite → user receives email
 * → clicks link → account created + user_team_role inserted.
 */
export const invitation = pgTable("invitation", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
  roleId:         uuid("role_id").notNull().references(() => role.id),
  invitedBy:      uuid("invited_by").notNull().references(() => user.id),
  email:          text("email").notNull(),
  token:          text("token").notNull().unique(),
  status:         invitationStatusEnum("status").notNull().default("pending"),
  expiresAt:      timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt:     timestamp("accepted_at", { withTimezone: true }),
  ...createdAt,
}, (t) => [
  index("invitation_org_idx").on(t.organisationId),
  index("invitation_token_idx").on(t.token),
]);
