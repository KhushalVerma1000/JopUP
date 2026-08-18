/**
 * MODULE 14 — EMPLOYEE HR & PAYROLL (PowerEmp)
 * module_key: "employee_hr"
 *
 * Manages the org's OWN internal staff (its HR/recruiters/managers),
 * as distinct from `candidate` (module 04), which is the talent pool
 * the org places with clients. employee_profile extends `user` with
 * HR-specific data — every employee is a user, not every user is an
 * employee (job seekers and external stakeholders never get one).
 *
 * Tables:
 *   employee_profile — HR record for an internal staff member
 *   payroll_run       — a payroll batch for a period (e.g. "March 2024")
 *   payroll_entry      — one employee's line within a payroll run
 *
 * Key design decisions:
 *   - One employee_profile per user, enforced via unique index on user_id.
 *     Not every `user` row needs one — only staff the org runs payroll for.
 *   - compensation is jsonb, not fixed columns, so pay structures (base +
 *     variable + allowances) vary per org without migrations, matching
 *     the same "no migration for new shape" philosophy as plan.limits.
 *   - payroll_run/payroll_entry split mirrors credit_account/
 *     credit_transaction: a header the app can lock/process, and
 *     append-only detail rows for audit.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  decimal,
  date,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";

// ─── Enums ───────────────────────────────────

export const employmentTypeInternalEnum = pgEnum("employment_type_internal", [
  "full_time",
  "part_time",
  "contract",
  "intern",
]);

export const employeeStatusEnum = pgEnum("employee_status", [
  "active",
  "on_leave",
  "notice_period",
  "exited",
]);

export const payrollRunStatusEnum = pgEnum("payroll_run_status", [
  "draft",
  "processing",
  "completed",
  "failed",
]);

export const payrollEntryStatusEnum = pgEnum("payroll_entry_status", [
  "pending",
  "paid",
  "failed",
  "held",
]);

// ─── Tables ──────────────────────────────────

/**
 * employee_profile
 * HR-specific extension of a `user` row. One-to-one with user.id.
 *
 * compensation shape:
 *   { base_salary, currency, pay_frequency: "monthly"|"biweekly",
 *     allowances: { hra, transport, other }, variable_pct }
 */
export const employeeProfile = pgTable("employee_profile", {
  id:                  pkUuid(),
  organisationId:      orgId().references(() => organisation.id, { onDelete: "cascade" }),
  userId:              uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  teamId:              uuid("team_id").references(() => team.id, { onDelete: "set null" }),
  reportingManagerId:  uuid("reporting_manager_id").references(() => user.id, { onDelete: "set null" }),

  employeeCode:        text("employee_code"),
  designation:         text("designation"),
  department:          text("department"),
  employmentType:      employmentTypeInternalEnum("employment_type").notNull().default("full_time"),
  status:              employeeStatusEnum("status").notNull().default("active"),

  dateOfJoining:       date("date_of_joining"),
  dateOfExit:          date("date_of_exit"),

  compensation:        jsonb("compensation").default(sql`'{}'::jsonb`),
  customFields:        jsonb("custom_fields").default(sql`'{}'::jsonb`),

  ...timestamps,
}, (t) => [
  uniqueIndex("emp_profile_user_idx").on(t.userId),
  index("emp_profile_org_idx").on(t.organisationId),
  index("emp_profile_team_idx").on(t.teamId),
  index("emp_profile_status_idx").on(t.status),
]);

/**
 * payroll_run
 * A payroll batch for one period. total_amount is the sum of its
 * payroll_entry.net_pay values, maintained by the application when
 * entries are added/updated.
 */
export const payrollRun = pgTable("payroll_run", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  createdBy:      uuid("created_by").notNull().references(() => user.id),

  periodLabel:    text("period_label").notNull(),
  periodStart:    date("period_start").notNull(),
  periodEnd:      date("period_end").notNull(),

  status:         payrollRunStatusEnum("status").notNull().default("draft"),
  totalAmount:    decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),

  processedAt:    timestamp("processed_at", { withTimezone: true }),
  ...createdAt,
}, (t) => [
  index("payrun_org_idx").on(t.organisationId),
  index("payrun_status_idx").on(t.status),
]);

/**
 * payroll_entry
 * One employee's line within a payroll_run. Append-only once paid —
 * corrections should be a new run/entry, not an edit, to preserve
 * the audit trail (mirrors credit_transaction's ledger philosophy).
 */
export const payrollEntry = pgTable("payroll_entry", {
  id:                 pkUuid(),
  payrollRunId:       uuid("payroll_run_id").notNull().references(() => payrollRun.id, { onDelete: "cascade" }),
  employeeProfileId:  uuid("employee_profile_id").notNull().references(() => employeeProfile.id),

  grossPay:           decimal("gross_pay", { precision: 12, scale: 2 }).notNull(),
  deductions:         decimal("deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  netPay:             decimal("net_pay", { precision: 12, scale: 2 }).notNull(),

  status:             payrollEntryStatusEnum("status").notNull().default("pending"),
  paidAt:             timestamp("paid_at", { withTimezone: true }),

  ...createdAt,
}, (t) => [
  index("payentry_run_idx").on(t.payrollRunId),
  index("payentry_employee_idx").on(t.employeeProfileId),
]);
