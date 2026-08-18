/**
 * MODULE 16 — CLIENT & CANDIDATE COMMUNICATION (SPOC Mailer)
 * module_key: "client_communication"
 *
 * This is NOT a bulk/marketing email module. It's a targeted,
 * transactional mailer for sending trackers, status reports, offer
 * letters, and updates to the RIGHT people at a client — and to
 * candidates — with an explicit To/CC picker, the way a recruiter
 * actually composes these emails today (just with drag-drop
 * attachments and no manual address book lookup).
 *
 * The core problem this solves: a single client account has MANY
 * SPOCs (HR contact, finance contact, hiring manager, escalation
 * contact...), and every tracker email needs a different mix of
 * "send to X, cc Y and Z, also cc our own account manager." Getting
 * that recipient list right by hand, every time, doesn't scale.
 *
 * Tables:
 *   email_sender_identity   — verified "from" addresses the org can send as
 *   client_spoc              — a client's named contacts (many per client)
 *   client_internal_contact — which of OUR people are the default cc for a client
 *   tracker_template          — defines a reusable tracker's column layout
 *                               (e.g. "Interview Tracker": Name, Number,
 *                               Position, Location, Interview Date/Time,
 *                               Current Employer, Current CTC)
 *   tracker                    — one generated tracker: a snapshotted table
 *                               of rows, embedded as an HTML table directly
 *                               in an email body (not a file attachment)
 *   email_template            — reusable subject/body for recurring sends
 *   email_message              — one composed/sent email (draft or sent),
 *                               optionally embedding one tracker
 *   email_recipient            — one To/CC/BCC line on a message, sourced
 *                               from a spoc, an internal user, a candidate,
 *                               or a one-off manual address
 *   email_attachment            — drag-dropped files on a message: CVs of
 *                               the candidates in the tracker, other
 *                               reports, or a downloadable copy of the
 *                               tracker itself
 *   email_message_reference    — links a message to the candidates /
 *                               applications a tracker actually covers
 *
 * Key design decisions:
 *   - A TRACKER IS DATA, NOT A FILE. Real-world trackers (see the
 *     reference screenshot this schema was built from) are an HTML
 *     table pasted straight into the email body — Name, Number,
 *     Position, Location, Interview Date/Time, Current Employer,
 *     Current CTC, one row per candidate. tracker.rows is a jsonb
 *     snapshot of exactly those cell values at send time, rendered
 *     into email_message.body_html as an inline table. It is
 *     deliberately NOT re-derived live from `candidate`/`application`
 *     on every read — interview times, CTC, etc. shown in a tracker
 *     that already went out must never silently change after the fact.
 *   - tracker_template.columns is the configurable column layout
 *     (key/label/source_field) so "Interview Tracker" vs "Submission
 *     Tracker" vs "Offer Tracker" are just different templates, not
 *     different tables — matches the plan-toggle philosophy of the
 *     rest of this schema: new tracker types are data, not migrations.
 *   - Each tracker.rows entry carries its source candidate_id, so a
 *     "drag in the CVs for this tracker" action in the compose UI can
 *     resolve straight to each candidate's resume document and add
 *     them as email_attachment rows without the user hunting one by one.
 *   - client_spoc replaces the single contact_name/contact_email fields
 *     on `client` (03-clients.ts) for anything communication-related.
 *     Those fields stay for "who do we generally deal with"; SPOCs are
 *     "who specifically receives what." spoc_type lets the compose UI
 *     pre-suggest "send tracker to HR spocs, cc finance spocs on
 *     invoices" instead of the user hunting through a flat list.
 *   - client_internal_contact is the mirror table for OUR side: which
 *     internal users (account owner, recruiter, team lead) should be
 *     suggested/defaulted into CC for a given client, so the compose
 *     screen can pre-populate the CC field instead of starting blank.
 *   - email_recipient stores exactly ONE of client_spoc_id /
 *     internal_user_id / candidate_id (enforced at the application
 *     layer) PLUS a snapshotted email_address + display_name — so if a
 *     SPOC's email later changes, historical sent emails still show
 *     what was actually used. Real trackers commonly cc a long mixed
 *     list of internal staff and client spocs together (see reference
 *     screenshot) — this table is what lets that flat "to" line be
 *     decomposed into who's internal, who's a spoc, and who's neither.
 *   - email_message links to at most one primary client AND/OR
 *     candidate for "who is this email fundamentally about," while
 *     email_message_reference is a many-to-many table for trackers
 *     that report on a whole batch of candidates/applications at once
 *     (e.g. a weekly submission tracker covering 12 candidates).
 *   - email_attachment.source distinguishes a fresh drag-drop upload
 *     from attaching an existing document (module 07), a candidate's
 *     CV, or a downloadable export of a tracker — without four
 *     separate tables.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { pkUuid, orgId, timestamps, createdAt } from "./_helpers";
import { organisation, team, user } from "./02-identity";
import { client } from "./03-clients";
import { candidate } from "./04-candidates";

// ─── Enums ───────────────────────────────────

export const spocTypeEnum = pgEnum("spoc_type", [
  "primary",
  "hr",
  "finance",
  "hiring_manager",
  "technical",
  "escalation",
  "other",
]);

export const spocStatusEnum = pgEnum("spoc_status", [
  "active",
  "inactive",
]);

export const internalContactRoleEnum = pgEnum("internal_contact_role", [
  "account_owner",
  "recruiter",
  "team_lead",
  "manager",
  "finance",
  "other",
]);

export const trackerTypeEnum = pgEnum("tracker_type", [
  "interview_tracker",
  "submission_tracker",
  "offer_tracker",
  "joining_tracker",
  "status_tracker",
  "custom",
]);

export const emailMessageTypeEnum = pgEnum("email_message_type", [
  "tracker",          // candidate pipeline / submission tracker
  "status_update",
  "offer_letter",
  "invoice_notice",
  "interview_schedule",
  "general",
]);

export const emailMessageStatusEnum = pgEnum("email_message_status", [
  "draft",
  "queued",
  "sent",
  "failed",
]);

export const emailRecipientRoleEnum = pgEnum("email_recipient_role", [
  "to",
  "cc",
  "bcc",
]);

export const emailRecipientSourceEnum = pgEnum("email_recipient_source", [
  "client_spoc",
  "internal_user",
  "candidate",
  "manual",
  // manual = one-off address typed in, not pulled from any directory
]);

export const emailRecipientStatusEnum = pgEnum("email_recipient_status", [
  "pending",
  "sent",
  "delivered",
  "opened",
  "bounced",
  "failed",
]);

export const emailAttachmentSourceEnum = pgEnum("email_attachment_source", [
  "upload",             // fresh drag-drop file
  "document_link",      // existing document.id (module 07) attached, not re-uploaded
  "candidate_cv",        // a candidate's resume, drag-dropped alongside a tracker
  "tracker_export",     // downloadable file copy of a tracker (PDF/XLSX), distinct from the inline HTML table
]);

// ─── Tables ──────────────────────────────────

/**
 * email_sender_identity
 * Verified "from" addresses available to send as. Sending from an
 * unverified identity should be blocked at the application layer.
 */
export const emailSenderIdentity = pgTable("email_sender_identity", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  fromName:       text("from_name").notNull(),
  fromEmail:      text("from_email").notNull(),
  replyTo:        text("reply_to"),
  isVerified:     boolean("is_verified").notNull().default(false),
  isDefault:      boolean("is_default").notNull().default(false),
  ...createdAt,
}, (t) => [
  index("esi_org_idx").on(t.organisationId),
]);

/**
 * client_spoc
 * A named contact person at a client company. A client can have many —
 * this is the directory the To/CC picker is built from.
 *
 * spoc_type drives smart defaults in the compose UI: e.g. pre-check
 * every "hr" spoc as To when sending a candidate tracker, pre-check
 * "finance" spocs as CC when sending an invoice_notice.
 * receives_trackers_by_default: pre-ticked in the tracker-send picker.
 */
export const clientSpoc = pgTable("client_spoc", {
  id:                        pkUuid(),
  organisationId:            orgId().references(() => organisation.id, { onDelete: "cascade" }),
  clientId:                  uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  createdBy:                 uuid("created_by").notNull().references(() => user.id),

  name:                      text("name").notNull(),
  email:                     text("email").notNull(),
  phone:                     text("phone"),
  designation:               text("designation"),
  spocType:                  spocTypeEnum("spoc_type").notNull().default("other"),

  isPrimary:                 boolean("is_primary").notNull().default(false),
  status:                    spocStatusEnum("status").notNull().default("active"),
  receivesTrackersByDefault: boolean("receives_trackers_by_default").notNull().default(true),

  notes:                     text("notes"),
  customFields:              jsonb("custom_fields").default(sql`'{}'::jsonb`),

  ...timestamps,
}, (t) => [
  index("spoc_org_idx").on(t.organisationId),
  index("spoc_client_idx").on(t.clientId),
  index("spoc_type_idx").on(t.clientId, t.spocType),
  index("spoc_status_idx").on(t.status),
]);

/**
 * client_internal_contact
 * Which of OUR people should be suggested/defaulted into CC for a
 * given client's emails. is_default_cc = true means the compose UI
 * pre-populates them in CC without the sender having to remember.
 */
export const clientInternalContact = pgTable("client_internal_contact", {
  id:            pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  clientId:      uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  userId:        uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

  role:          internalContactRoleEnum("role").notNull().default("other"),
  isDefaultCc:   boolean("is_default_cc").notNull().default(false),
  notes:         text("notes"),

  ...createdAt,
}, (t) => [
  index("cic_org_idx").on(t.organisationId),
  index("cic_client_idx").on(t.clientId),
  index("cic_user_idx").on(t.userId),
]);

/**
 * tracker_template
 * The reusable COLUMN LAYOUT for a tracker table — what "Interview
 * Tracker" or "Submission Tracker" actually means for this org/team.
 *
 * columns is an ordered jsonb array, each entry:
 *   { key: "current_ctc", label: "Current CTC", sourceField: "candidate.customFields.current_ctc" }
 * source_field is a dotted path the app resolves when GENERATING a
 * tracker (candidate.*, application.*, applicationStageLog.stageData.*).
 * Once generated, tracker.rows holds the resolved values, not the path —
 * editing a template later never changes trackers already sent.
 */
export const trackerTemplate = pgTable("tracker_template", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
  // NULL team_id = shared org-wide template
  createdBy:      uuid("created_by").notNull().references(() => user.id),

  name:           text("name").notNull(),
  // e.g. "Interview Tracker", "Weekly Submission Tracker"
  trackerType:    trackerTypeEnum("tracker_type").notNull().default("custom"),
  columns:        jsonb("columns").notNull().default(sql`'[]'::jsonb`),
  isDefault:      boolean("is_default").notNull().default(false),

  ...timestamps,
}, (t) => [
  index("ttpl_org_idx").on(t.organisationId),
  index("ttpl_team_idx").on(t.teamId),
  index("ttpl_type_idx").on(t.trackerType),
]);

/**
 * tracker
 * One generated tracker — a snapshotted table of rows meant to be
 * rendered as an HTML table inline in an email body (see email_message
 * .tracker_id below), not sent as a file.
 *
 * rows shape (one entry per candidate row in the table):
 *   [{ candidateId: "<uuid>", applicationId: "<uuid|null>",
 *      values: { candidate_name: "Muskan Tiwari", number: "7521834986",
 *                position: "Sales Officer", location: "Mahanagar",
 *                interview_date: "2026-08-07", interview_time: "11:00 AM",
 *                current_employer: "ICICI Bank", current_ctc: "2 LPA" } }]
 * Keys in `values` match tracker_template.columns[].key at generation
 * time. candidate_id on each row is what lets "attach CVs for this
 * tracker" resolve straight to each candidate's resume document.
 */
export const tracker = pgTable("tracker", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").notNull().references(() => team.id),
  clientId:       uuid("client_id").references(() => client.id, { onDelete: "set null" }),
  templateId:     uuid("template_id").notNull().references(() => trackerTemplate.id),
  createdBy:      uuid("created_by").notNull().references(() => user.id),

  title:          text("title").notNull(),
  // e.g. "Sales Officer — Interview Tracker, 7 Aug 2026"
  trackerType:    trackerTypeEnum("tracker_type").notNull().default("custom"),
  // Denormalised from template at generation time — a template edited
  // later must not reclassify trackers already sent.

  rows:           jsonb("rows").notNull().default(sql`'[]'::jsonb`),
  rowCount:       integer("row_count").notNull().default(0),

  generatedAt:    timestamp("generated_at", { withTimezone: true }).notNull().default(sql`now()`),
  ...createdAt,
}, (t) => [
  index("trk_org_idx").on(t.organisationId),
  index("trk_team_idx").on(t.teamId),
  index("trk_client_idx").on(t.clientId),
  index("trk_type_idx").on(t.trackerType),
]);

/**
 * email_template
 * Reusable subject/body for recurring sends (weekly tracker, standard
 * offer letter copy, etc). team_id NULL = shared org-wide template.
 */
export const emailTemplate = pgTable("email_template", {
  id:             pkUuid(),
  organisationId: orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:         uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
  createdBy:      uuid("created_by").notNull().references(() => user.id),

  name:           text("name").notNull(),
  messageType:    emailMessageTypeEnum("message_type").notNull().default("general"),
  subject:        text("subject").notNull(),
  bodyHtml:       text("body_html").notNull(),
  // Supports merge tags e.g. {{spoc_name}}, {{client_name}}, {{week_ending}}

  ...timestamps,
}, (t) => [
  index("etpl_org_idx").on(t.organisationId),
  index("etpl_team_idx").on(t.teamId),
  index("etpl_type_idx").on(t.messageType),
]);

/**
 * email_message
 * One composed email — draft or sent. related_client_id / related_
 * candidate_id capture "who is this fundamentally about" for inbox-style
 * filtering (e.g. "show me every email sent to Acme Corp"); a tracker
 * covering many candidates additionally uses email_message_reference.
 */
export const emailMessage = pgTable("email_message", {
  id:               pkUuid(),
  organisationId:   orgId().references(() => organisation.id, { onDelete: "cascade" }),
  teamId:           uuid("team_id").notNull().references(() => team.id),
  createdBy:        uuid("created_by").notNull().references(() => user.id),
  senderId:         uuid("sender_id").notNull().references(() => emailSenderIdentity.id),
  templateId:       uuid("template_id").references(() => emailTemplate.id, { onDelete: "set null" }),
  trackerId:        uuid("tracker_id").references(() => tracker.id, { onDelete: "set null" }),
  // The tracker table rendered inline in body_html, if this is a tracker email

  relatedClientId:    uuid("related_client_id").references(() => client.id, { onDelete: "set null" }),
  relatedCandidateId: uuid("related_candidate_id").references(() => candidate.id, { onDelete: "set null" }),

  messageType:      emailMessageTypeEnum("message_type").notNull().default("general"),
  subject:          text("subject").notNull(),
  bodyHtml:         text("body_html").notNull(),

  status:           emailMessageStatusEnum("status").notNull().default("draft"),
  scheduledAt:      timestamp("scheduled_at", { withTimezone: true }),
  sentAt:           timestamp("sent_at", { withTimezone: true }),

  ...timestamps,
}, (t) => [
  index("emsg_org_idx").on(t.organisationId),
  index("emsg_team_idx").on(t.teamId),
  index("emsg_client_idx").on(t.relatedClientId),
  index("emsg_candidate_idx").on(t.relatedCandidateId),
  index("emsg_status_idx").on(t.status),
  index("emsg_type_idx").on(t.messageType),
  index("emsg_tracker_idx").on(t.trackerId),
]);

/**
 * email_recipient
 * One To/CC/BCC line on a message. Exactly one of client_spoc_id /
 * internal_user_id / candidate_id should be set, matching `source`
 * (source = "manual" leaves all three NULL). email_address and
 * display_name are snapshotted at send time so the historical record
 * is accurate even if the underlying contact's email later changes.
 */
export const emailRecipient = pgTable("email_recipient", {
  id:              pkUuid(),
  emailMessageId:  uuid("email_message_id").notNull().references(() => emailMessage.id, { onDelete: "cascade" }),

  role:            emailRecipientRoleEnum("role").notNull().default("to"),
  source:          emailRecipientSourceEnum("source").notNull().default("manual"),

  clientSpocId:    uuid("client_spoc_id").references(() => clientSpoc.id, { onDelete: "set null" }),
  internalUserId:  uuid("internal_user_id").references(() => user.id, { onDelete: "set null" }),
  candidateId:     uuid("candidate_id").references(() => candidate.id, { onDelete: "set null" }),

  emailAddress:    text("email_address").notNull(),
  // Snapshot — always populated regardless of source
  displayName:     text("display_name"),

  status:          emailRecipientStatusEnum("status").notNull().default("pending"),
  sentAt:          timestamp("sent_at", { withTimezone: true }),
  deliveredAt:     timestamp("delivered_at", { withTimezone: true }),
  openedAt:        timestamp("opened_at", { withTimezone: true }),
  bouncedAt:       timestamp("bounced_at", { withTimezone: true }),
  errorMessage:    text("error_message"),

  ...createdAt,
}, (t) => [
  index("erec_message_idx").on(t.emailMessageId),
  index("erec_spoc_idx").on(t.clientSpocId),
  index("erec_internal_user_idx").on(t.internalUserId),
  index("erec_candidate_idx").on(t.candidateId),
  index("erec_status_idx").on(t.status),
]);

/**
 * email_attachment
 * Drag-dropped files on a message. This is where candidate CVs go —
 * separate from the tracker's inline HTML table (email_message
 * .tracker_id above), matching the real workflow of "here's the
 * tracker, and I've also attached the candidates' resumes."
 *
 * source_document_id links back to an existing document (module 07)
 * when attaching a resume already on file rather than re-uploading.
 * candidate_id tags a candidate_cv attachment to the specific
 * candidate it belongs to, so the compose UI's "attach CVs for this
 * tracker" action can bulk-add one row per candidate in tracker.rows.
 * tracker_id is set when source = tracker_export — a downloadable
 * file copy (PDF/XLSX) of a tracker, distinct from the inline table.
 */
export const emailAttachment = pgTable("email_attachment", {
  id:               pkUuid(),
  emailMessageId:   uuid("email_message_id").notNull().references(() => emailMessage.id, { onDelete: "cascade" }),
  uploadedBy:       uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),

  source:           emailAttachmentSourceEnum("source").notNull().default("upload"),
  fileName:         text("file_name").notNull(),
  fileUrl:          text("file_url").notNull(),
  fileSizeBytes:    text("file_size_bytes"),
  mimeType:         text("mime_type"),

  sourceDocumentId: uuid("source_document_id"),
  // Optional FK to document.id (module 07) — resume already on file

  candidateId:      uuid("candidate_id").references(() => candidate.id, { onDelete: "set null" }),
  // Set when source = candidate_cv — which candidate this resume belongs to

  trackerId:        uuid("tracker_id").references(() => tracker.id, { onDelete: "set null" }),
  // Set when source = tracker_export — downloadable copy of a tracker

  ...createdAt,
}, (t) => [
  index("eatt_message_idx").on(t.emailMessageId),
  index("eatt_candidate_idx").on(t.candidateId),
  index("eatt_tracker_idx").on(t.trackerId),
]);

/**
 * email_message_reference
 * Many-to-many link between a message and the candidates/applications
 * it actually reports on. A single tracker email routinely covers a
 * whole batch (e.g. 12 candidates in one weekly submission tracker) —
 * this table is what lets "which trackers mention candidate X" or
 * "what did we send about application Y" be a simple query instead of
 * parsing attachment contents.
 */
export const emailMessageReference = pgTable("email_message_reference", {
  id:              pkUuid(),
  emailMessageId:  uuid("email_message_id").notNull().references(() => emailMessage.id, { onDelete: "cascade" }),

  entityType:      text("entity_type").notNull(),
  // "candidate" | "application" | "job_posting"
  entityId:        uuid("entity_id").notNull(),

  ...createdAt,
}, (t) => [
  index("emref_message_idx").on(t.emailMessageId),
  index("emref_entity_idx").on(t.entityType, t.entityId),
]);
