/**
 * MODULE 12 — VENDOR RELATIONSHIP OPS (VRO)
 * module_key: "vendor_management"
 *
 * Manages third-party vendors an organisation works with: staffing
 * partners, subcontractors, background-check providers, payroll
 * processors, etc. Mirrors the client module's ownership/sharing model
 * but for the supply side of the business.
 *
 * Tables:
 *   vendor              — vendor company profile owned by a team
 *   vendor_document      — SLA docs, contracts, compliance certificates
 *   vendor_sla_log        — periodic SLA compliance measurements
 *   vendor_risk_alert     — early-warning flags surfaced to managers
 *
 * Key design decisions:
 *   - Same owner_team_id / shared_org_wide pattern as client (03-clients.ts)
 *     for consistency across every "external party" table.
 *   - sla_target_pct on vendor + periodic vendor_sla_log entries let the
 *     dashboard compute a rolling average without recomputation logic
 *     baked into the schema — application layer aggregates on read.
 *   - vendor_risk_alert is intentionally separate from vendor_sla_log:
 *     an SLA dip is a *measurement*, a risk alert is a *decision* that
 *     the dip (or some other signal) warrants manager attention.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  date,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";

// ─── Enums ───────────────────────────────────

export const vendorCategoryEnum = pgEnum("vendor_category", [
  "staffing_partner",
  "subcontractor",
  "background_check",
  "payroll_processor",
  "training_provider",
  "other",
]);

export const vendorStatusEnum = pgEnum("vendor_status", [
  "preferred",
  "active",
  "watch",      // under review — SLA or compliance concerns
  "inactive",
]);

export const vendorDocumentTypeEnum = pgEnum("vendor_document_type", [
  "contract",
  "sla_agreement",
  "insurance_certificate",
  "compliance_cert",
  "nda",
  "other",
]);

export const riskAlertSeverityEnum = pgEnum("risk_alert_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

// ─── Tables ──────────────────────────────────

/**
 * vendor
 * A third-party company the org partners with. owner_team_id follows
 * the same convention as client.owner_team_id.
 */
export const vendor = pgTable("vendor", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  ownerTeamId:    uuid("owner_team_id").notNull().references(() => team.id),
  createdBy:      uuid("created_by").notNull().references(() => user.id),
  updatedBy:      uuid("updated_by").references(() => user.id),

  companyName:    text("company_name").notNull(),
  category:       vendorCategoryEnum("category").notNull().default("other"),
  website:        text("website"),

  contactName:    text("contact_name"),
  contactEmail:   text("contact_email"),
  contactPhone:   text("contact_phone"),

  address:        jsonb("address"),
  // { line1, line2, city, state, country, postcode }

  status:         vendorStatusEnum("status").notNull().default("active"),
  slaTargetPct:   doublePrecision("sla_target_pct").default(95),
  notes:          text("notes"),

  sharedOrgWide:  boolean("shared_org_wide").notNull().default(false),
  customFields:   jsonb("custom_fields").default(sql`'{}'::jsonb`),

  ...timestamps,
}, (t) => [
  index("vendor_org_idx").on(t.organisationId),
  index("vendor_team_idx").on(t.ownerTeamId),
  index("vendor_status_idx").on(t.status),
]);

/**
 * vendor_document
 * Contracts, SLA agreements, and compliance certificates on file.
 * expires_at drives renewal reminders (e.g. insurance certs).
 */
export const vendorDocument = pgTable("vendor_document", {
  id:            pkUuid(),
  vendorId:      uuid("vendor_id").notNull().references(() => vendor.id, { onDelete: "cascade" }),
  uploadedBy:    uuid("uploaded_by").notNull().references(() => user.id),

  documentType:  vendorDocumentTypeEnum("document_type").notNull(),
  fileName:      text("file_name").notNull(),
  fileUrl:       text("file_url").notNull(),
  expiresAt:     date("expires_at"),

  ...createdAt,
}, (t) => [
  index("vdoc_vendor_idx").on(t.vendorId),
]);

/**
 * vendor_sla_log
 * Periodic SLA measurement for a vendor. One row per measurement period
 * (e.g. monthly). Rolling averages are computed at the application layer.
 */
export const vendorSlaLog = pgTable("vendor_sla_log", {
  id:           pkUuid(),
  vendorId:     uuid("vendor_id").notNull().references(() => vendor.id, { onDelete: "cascade" }),
  recordedBy:   uuid("recorded_by").notNull().references(() => user.id),

  periodLabel:  text("period_label").notNull(),
  periodDate:   date("period_date").notNull(),
  slaPct:       doublePrecision("sla_pct").notNull(),
  notes:        text("notes"),

  ...createdAt,
}, (t) => [
  index("vsla_vendor_idx").on(t.vendorId),
  index("vsla_period_idx").on(t.vendorId, t.periodDate),
]);

/**
 * vendor_risk_alert
 * Manager-facing early-warning flag. Raised manually or by an automated
 * rule (e.g. SLA dropped below target for 2 consecutive periods).
 * resolved_at NULL = still open.
 */
export const vendorRiskAlert = pgTable("vendor_risk_alert", {
  id:           pkUuid(),
  vendorId:     uuid("vendor_id").notNull().references(() => vendor.id, { onDelete: "cascade" }),
  raisedBy:     uuid("raised_by").references(() => user.id, { onDelete: "set null" }),
  // NULL raised_by = system-generated alert

  severity:     riskAlertSeverityEnum("severity").notNull().default("medium"),
  message:      text("message").notNull(),

  resolvedAt:   timestamp("resolved_at", { withTimezone: true }),
  resolvedBy:   uuid("resolved_by").references(() => user.id, { onDelete: "set null" }),

  ...createdAt,
}, (t) => [
  index("vra_vendor_idx").on(t.vendorId),
  index("vra_open_idx").on(t.vendorId, t.resolvedAt),
]);
