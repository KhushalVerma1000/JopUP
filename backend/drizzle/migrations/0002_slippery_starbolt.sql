CREATE TYPE "public"."bench_activity_type" AS ENUM('call', 'email', 'submission', 'note', 'status_changed');--> statement-breakpoint
CREATE TYPE "public"."bench_availability" AS ENUM('available', 'engaged', 'not_available');--> statement-breakpoint
CREATE TYPE "public"."bench_heat" AS ENUM('hot', 'warm', 'new', 'cold');--> statement-breakpoint
CREATE TYPE "public"."bench_prospect_status" AS ENUM('new', 'contacted', 'qualified', 'submitted', 'interviewing', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."email_attachment_source" AS ENUM('upload', 'document_link', 'candidate_cv', 'tracker_export');--> statement-breakpoint
CREATE TYPE "public"."email_message_status" AS ENUM('draft', 'queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_message_type" AS ENUM('tracker', 'status_update', 'offer_letter', 'invoice_notice', 'interview_schedule', 'general');--> statement-breakpoint
CREATE TYPE "public"."email_recipient_role" AS ENUM('to', 'cc', 'bcc');--> statement-breakpoint
CREATE TYPE "public"."email_recipient_source" AS ENUM('client_spoc', 'internal_user', 'candidate', 'manual');--> statement-breakpoint
CREATE TYPE "public"."email_recipient_status" AS ENUM('pending', 'sent', 'delivered', 'opened', 'bounced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'on_leave', 'notice_period', 'exited');--> statement-breakpoint
CREATE TYPE "public"."employment_type_internal" AS ENUM('full_time', 'part_time', 'contract', 'intern');--> statement-breakpoint
CREATE TYPE "public"."internal_contact_role" AS ENUM('account_owner', 'recruiter', 'team_lead', 'manager', 'finance', 'other');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('receivable', 'payable');--> statement-breakpoint
CREATE TYPE "public"."module_category" AS ENUM('core', 'recruit', 'crm', 'finance', 'hr', 'bench', 'communication', 'vendor', 'portal', 'analytics');--> statement-breakpoint
CREATE TYPE "public"."module_status" AS ENUM('active', 'beta', 'deprecated', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'card', 'cheque', 'upi', 'other');--> statement-breakpoint
CREATE TYPE "public"."payroll_entry_status" AS ENUM('pending', 'paid', 'failed', 'held');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."risk_alert_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."spoc_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."spoc_type" AS ENUM('primary', 'hr', 'finance', 'hiring_manager', 'technical', 'escalation', 'other');--> statement-breakpoint
CREATE TYPE "public"."tracker_type" AS ENUM('interview_tracker', 'submission_tracker', 'offer_tracker', 'joining_tracker', 'status_tracker', 'custom');--> statement-breakpoint
CREATE TYPE "public"."vendor_category" AS ENUM('staffing_partner', 'subcontractor', 'background_check', 'payroll_processor', 'training_provider', 'other');--> statement-breakpoint
CREATE TYPE "public"."vendor_document_type" AS ENUM('contract', 'sla_agreement', 'insurance_certificate', 'compliance_cert', 'nda', 'other');--> statement-breakpoint
CREATE TYPE "public"."vendor_status" AS ENUM('preferred', 'active', 'watch', 'inactive');--> statement-breakpoint
CREATE TABLE "bench_activity_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"performed_by" uuid NOT NULL,
	"activity_type" "bench_activity_type" NOT NULL,
	"content" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bench_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"owner_team_id" uuid NOT NULL,
	"availability" "bench_availability" DEFAULT 'available' NOT NULL,
	"heat_tag" "bench_heat" DEFAULT 'new' NOT NULL,
	"rate_expectation" text,
	"available_from" date,
	"years_experience" text,
	"marketing_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bench_prospect" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"bench_profile_id" uuid NOT NULL,
	"assigned_to" uuid,
	"created_by" uuid NOT NULL,
	"prospect_company" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"status" "bench_prospect_status" DEFAULT 'new' NOT NULL,
	"rate_offered" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_internal_contact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "internal_contact_role" DEFAULT 'other' NOT NULL,
	"is_default_cc" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_spoc" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"designation" text,
	"spoc_type" "spoc_type" DEFAULT 'other' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" "spoc_status" DEFAULT 'active' NOT NULL,
	"receives_trackers_by_default" boolean DEFAULT true NOT NULL,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_message_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"source" "email_attachment_source" DEFAULT 'upload' NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size_bytes" text,
	"mime_type" text,
	"source_document_id" uuid,
	"candidate_id" uuid,
	"tracker_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"template_id" uuid,
	"tracker_id" uuid,
	"related_client_id" uuid,
	"related_candidate_id" uuid,
	"message_type" "email_message_type" DEFAULT 'general' NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"status" "email_message_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_message_reference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_message_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_recipient" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_message_id" uuid NOT NULL,
	"role" "email_recipient_role" DEFAULT 'to' NOT NULL,
	"source" "email_recipient_source" DEFAULT 'manual' NOT NULL,
	"client_spoc_id" uuid,
	"internal_user_id" uuid,
	"candidate_id" uuid,
	"email_address" text NOT NULL,
	"display_name" text,
	"status" "email_recipient_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_sender_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"message_type" "email_message_type" DEFAULT 'general' NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid,
	"reporting_manager_id" uuid,
	"employee_code" text,
	"designation" text,
	"department" text,
	"employment_type" "employment_type_internal" DEFAULT 'full_time' NOT NULL,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"date_of_joining" date,
	"date_of_exit" date,
	"compensation" jsonb DEFAULT '{}'::jsonb,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"client_id" uuid,
	"vendor_id" uuid,
	"created_by" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"type" "invoice_type" NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"application_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "module_category" NOT NULL,
	"status" "module_status" DEFAULT 'active' NOT NULL,
	"is_credit_gated" boolean DEFAULT false NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_definition_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_profile_id" uuid NOT NULL,
	"gross_pay" numeric(12, 2) NOT NULL,
	"deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(12, 2) NOT NULL,
	"status" "payroll_entry_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"period_label" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"client_id" uuid,
	"template_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"tracker_type" "tracker_type" DEFAULT 'custom' NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"tracker_type" "tracker_type" DEFAULT 'custom' NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"owner_team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"company_name" text NOT NULL,
	"category" "vendor_category" DEFAULT 'other' NOT NULL,
	"website" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"address" jsonb,
	"status" "vendor_status" DEFAULT 'active' NOT NULL,
	"sla_target_pct" double precision DEFAULT 95,
	"notes" text,
	"shared_org_wide" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"document_type" "vendor_document_type" NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"expires_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_risk_alert" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"raised_by" uuid,
	"severity" "risk_alert_severity" DEFAULT 'medium' NOT NULL,
	"message" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_sla_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"period_label" text NOT NULL,
	"period_date" date NOT NULL,
	"sla_pct" double precision NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bench_activity_log" ADD CONSTRAINT "bench_activity_log_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_activity_log" ADD CONSTRAINT "bench_activity_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_profile" ADD CONSTRAINT "bench_profile_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_profile" ADD CONSTRAINT "bench_profile_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_profile" ADD CONSTRAINT "bench_profile_owner_team_id_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_prospect" ADD CONSTRAINT "bench_prospect_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_prospect" ADD CONSTRAINT "bench_prospect_bench_profile_id_bench_profile_id_fk" FOREIGN KEY ("bench_profile_id") REFERENCES "public"."bench_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_prospect" ADD CONSTRAINT "bench_prospect_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_prospect" ADD CONSTRAINT "bench_prospect_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_internal_contact" ADD CONSTRAINT "client_internal_contact_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_internal_contact" ADD CONSTRAINT "client_internal_contact_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_internal_contact" ADD CONSTRAINT "client_internal_contact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_spoc" ADD CONSTRAINT "client_spoc_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_spoc" ADD CONSTRAINT "client_spoc_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_spoc" ADD CONSTRAINT "client_spoc_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_email_message_id_email_message_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_tracker_id_tracker_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."tracker"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_sender_id_email_sender_identity_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."email_sender_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_template_id_email_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_tracker_id_tracker_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."tracker"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_related_client_id_client_id_fk" FOREIGN KEY ("related_client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_related_candidate_id_candidate_id_fk" FOREIGN KEY ("related_candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message_reference" ADD CONSTRAINT "email_message_reference_email_message_id_email_message_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_email_message_id_email_message_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_client_spoc_id_client_spoc_id_fk" FOREIGN KEY ("client_spoc_id") REFERENCES "public"."client_spoc"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_internal_user_id_user_id_fk" FOREIGN KEY ("internal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sender_identity" ADD CONSTRAINT "email_sender_identity_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_reporting_manager_id_user_id_fk" FOREIGN KEY ("reporting_manager_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entry" ADD CONSTRAINT "payroll_entry_payroll_run_id_payroll_run_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entry" ADD CONSTRAINT "payroll_entry_employee_profile_id_employee_profile_id_fk" FOREIGN KEY ("employee_profile_id") REFERENCES "public"."employee_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker" ADD CONSTRAINT "tracker_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker" ADD CONSTRAINT "tracker_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker" ADD CONSTRAINT "tracker_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker" ADD CONSTRAINT "tracker_template_id_tracker_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."tracker_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker" ADD CONSTRAINT "tracker_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_template" ADD CONSTRAINT "tracker_template_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_template" ADD CONSTRAINT "tracker_template_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_template" ADD CONSTRAINT "tracker_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_owner_team_id_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_risk_alert" ADD CONSTRAINT "vendor_risk_alert_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_risk_alert" ADD CONSTRAINT "vendor_risk_alert_raised_by_user_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_risk_alert" ADD CONSTRAINT "vendor_risk_alert_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_sla_log" ADD CONSTRAINT "vendor_sla_log_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_sla_log" ADD CONSTRAINT "vendor_sla_log_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bal_org_idx" ON "bench_activity_log" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "bal_entity_idx" ON "bench_activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bench_profile_candidate_idx" ON "bench_profile" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "bench_profile_org_idx" ON "bench_profile" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "bench_profile_team_idx" ON "bench_profile" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "bench_profile_availability_idx" ON "bench_profile" USING btree ("availability");--> statement-breakpoint
CREATE INDEX "bench_profile_heat_idx" ON "bench_profile" USING btree ("heat_tag");--> statement-breakpoint
CREATE INDEX "bp_org_idx" ON "bench_prospect" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "bp_profile_idx" ON "bench_prospect" USING btree ("bench_profile_id");--> statement-breakpoint
CREATE INDEX "bp_status_idx" ON "bench_prospect" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bp_assigned_idx" ON "bench_prospect" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "cic_org_idx" ON "client_internal_contact" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "cic_client_idx" ON "client_internal_contact" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "cic_user_idx" ON "client_internal_contact" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "spoc_org_idx" ON "client_spoc" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "spoc_client_idx" ON "client_spoc" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "spoc_type_idx" ON "client_spoc" USING btree ("client_id","spoc_type");--> statement-breakpoint
CREATE INDEX "spoc_status_idx" ON "client_spoc" USING btree ("status");--> statement-breakpoint
CREATE INDEX "eatt_message_idx" ON "email_attachment" USING btree ("email_message_id");--> statement-breakpoint
CREATE INDEX "eatt_candidate_idx" ON "email_attachment" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "eatt_tracker_idx" ON "email_attachment" USING btree ("tracker_id");--> statement-breakpoint
CREATE INDEX "emsg_org_idx" ON "email_message" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "emsg_team_idx" ON "email_message" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "emsg_client_idx" ON "email_message" USING btree ("related_client_id");--> statement-breakpoint
CREATE INDEX "emsg_candidate_idx" ON "email_message" USING btree ("related_candidate_id");--> statement-breakpoint
CREATE INDEX "emsg_status_idx" ON "email_message" USING btree ("status");--> statement-breakpoint
CREATE INDEX "emsg_type_idx" ON "email_message" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX "emsg_tracker_idx" ON "email_message" USING btree ("tracker_id");--> statement-breakpoint
CREATE INDEX "emref_message_idx" ON "email_message_reference" USING btree ("email_message_id");--> statement-breakpoint
CREATE INDEX "emref_entity_idx" ON "email_message_reference" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "erec_message_idx" ON "email_recipient" USING btree ("email_message_id");--> statement-breakpoint
CREATE INDEX "erec_spoc_idx" ON "email_recipient" USING btree ("client_spoc_id");--> statement-breakpoint
CREATE INDEX "erec_internal_user_idx" ON "email_recipient" USING btree ("internal_user_id");--> statement-breakpoint
CREATE INDEX "erec_candidate_idx" ON "email_recipient" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "erec_status_idx" ON "email_recipient" USING btree ("status");--> statement-breakpoint
CREATE INDEX "esi_org_idx" ON "email_sender_identity" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "etpl_org_idx" ON "email_template" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "etpl_team_idx" ON "email_template" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "etpl_type_idx" ON "email_template" USING btree ("message_type");--> statement-breakpoint
CREATE UNIQUE INDEX "emp_profile_user_idx" ON "employee_profile" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "emp_profile_org_idx" ON "employee_profile" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "emp_profile_team_idx" ON "employee_profile" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "emp_profile_status_idx" ON "employee_profile" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_org_idx" ON "invoice" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "invoice_team_idx" ON "invoice" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "invoice_client_idx" ON "invoice" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoice_vendor_idx" ON "invoice" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "invoice_status_idx" ON "invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_type_idx" ON "invoice" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ili_invoice_idx" ON "invoice_line_item" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ili_application_idx" ON "invoice_line_item" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "module_def_category_idx" ON "module_definition" USING btree ("category");--> statement-breakpoint
CREATE INDEX "module_def_status_idx" ON "module_definition" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_invoice_idx" ON "payment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payentry_run_idx" ON "payroll_entry" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "payentry_employee_idx" ON "payroll_entry" USING btree ("employee_profile_id");--> statement-breakpoint
CREATE INDEX "payrun_org_idx" ON "payroll_run" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "payrun_status_idx" ON "payroll_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trk_org_idx" ON "tracker" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "trk_team_idx" ON "tracker" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "trk_client_idx" ON "tracker" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "trk_type_idx" ON "tracker" USING btree ("tracker_type");--> statement-breakpoint
CREATE INDEX "ttpl_org_idx" ON "tracker_template" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "ttpl_team_idx" ON "tracker_template" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ttpl_type_idx" ON "tracker_template" USING btree ("tracker_type");--> statement-breakpoint
CREATE INDEX "vendor_org_idx" ON "vendor" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "vendor_team_idx" ON "vendor" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "vendor_status_idx" ON "vendor" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vdoc_vendor_idx" ON "vendor_document" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vra_vendor_idx" ON "vendor_risk_alert" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vra_open_idx" ON "vendor_risk_alert" USING btree ("vendor_id","resolved_at");--> statement-breakpoint
CREATE INDEX "vsla_vendor_idx" ON "vendor_sla_log" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vsla_period_idx" ON "vendor_sla_log" USING btree ("vendor_id","period_date");