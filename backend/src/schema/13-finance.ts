/**
 * MODULE 13 — FINANCE & INVOICING (FinMa)
 * module_key: "finance_management"
 *
 * Invoicing, accounts receivable/payable, and margin tracking.
 * An invoice can be RECEIVABLE (client owes the org, e.g. a placement
 * fee) or PAYABLE (org owes a vendor, e.g. a subcontractor payout).
 * Both flow through the same table so AR/AP dashboards share one query.
 *
 * Tables:
 *   invoice            — header record, either receivable or payable
 *   invoice_line_item   — itemised charges on an invoice
 *   payment             — money actually received/paid against an invoice
 *
 * Key design decisions:
 *   - type ("receivable" | "payable") + exactly one of client_id/vendor_id
 *     set (enforced at application layer) lets one table power both AR
 *     and AP views instead of maintaining two parallel schemas.
 *   - amount_paid is a running total maintained by the application
 *     whenever a payment row is inserted — avoids summing payments on
 *     every invoice list render. status is derived from amount_paid vs
 *     total_amount but stored for fast filtering/indexing.
 *   - invoice_line_item.application_id links a placement fee line item
 *     back to the recruitment pipeline that generated it, so margin
 *     analytics (FinMa's "profit margin analytics") can join revenue
 *     back to cost-per-hire without a separate reporting table.
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
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";
import { client } from "./03-clients";
import { vendor } from "./12-vendor";

// ─── Enums ───────────────────────────────────

export const invoiceTypeEnum = pgEnum("invoice_type", [
  "receivable",   // client owes the org
  "payable",      // org owes a vendor
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "void",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer",
  "card",
  "cheque",
  "upi",
  "other",
]);

// ─── Tables ──────────────────────────────────

/**
 * invoice
 * Header record for a receivable (client) or payable (vendor) invoice.
 * Exactly one of client_id / vendor_id should be set, matching `type`.
 */
export const invoice = pgTable("invoice", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").notNull().references(() => team.id),
  clientId:       uuid("client_id").references(() => client.id, { onDelete: "set null" }),
  vendorId:       uuid("vendor_id").references(() => vendor.id, { onDelete: "set null" }),
  createdBy:      uuid("created_by").notNull().references(() => user.id),

  invoiceNumber:  text("invoice_number").notNull(),
  type:           invoiceTypeEnum("type").notNull(),
  status:         invoiceStatusEnum("status").notNull().default("draft"),

  issueDate:      date("issue_date").notNull(),
  dueDate:        date("due_date").notNull(),
  currency:       text("currency").notNull().default("INR"),

  subtotal:       decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount:      decimal("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount:    decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  amountPaid:     decimal("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  // Maintained by the application on every payment insert

  notes:          text("notes"),

  ...timestamps,
}, (t) => [
  index("invoice_org_idx").on(t.organisationId),
  index("invoice_team_idx").on(t.teamId),
  index("invoice_client_idx").on(t.clientId),
  index("invoice_vendor_idx").on(t.vendorId),
  index("invoice_status_idx").on(t.status),
  index("invoice_type_idx").on(t.type),
]);

/**
 * invoice_line_item
 * Itemised charges on an invoice. application_id (optional) links a
 * placement-fee line item back to the recruitment application that
 * earned it — enables margin-per-hire analytics.
 */
export const invoiceLineItem = pgTable("invoice_line_item", {
  id:            pkUuid(),
  invoiceId:     uuid("invoice_id").notNull().references(() => invoice.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id"),
  // Optional FK to application.id (module 07) — set for placement-fee lines

  description:   text("description").notNull(),
  quantity:      integer("quantity").notNull().default(1),
  unitPrice:     decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
  amount:        decimal("amount", { precision: 12, scale: 2 }).notNull(),

  ...createdAt,
}, (t) => [
  index("ili_invoice_idx").on(t.invoiceId),
  index("ili_application_idx").on(t.applicationId),
]);

/**
 * payment
 * A single money movement against an invoice. Multiple payments can
 * apply to one invoice (partial payments). Application recalculates
 * invoice.amount_paid / status after each insert.
 */
export const payment = pgTable("payment", {
  id:          pkUuid(),
  invoiceId:   uuid("invoice_id").notNull().references(() => invoice.id, { onDelete: "cascade" }),
  recordedBy:  uuid("recorded_by").notNull().references(() => user.id),

  amount:      decimal("amount", { precision: 12, scale: 2 }).notNull(),
  method:      paymentMethodEnum("method").notNull().default("bank_transfer"),
  reference:   text("reference"),
  // Bank ref / transaction ID / cheque number

  paidAt:      timestamp("paid_at", { withTimezone: true }).notNull().default(sql`now()`),
  ...createdAt,
}, (t) => [
  index("payment_invoice_idx").on(t.invoiceId),
]);
