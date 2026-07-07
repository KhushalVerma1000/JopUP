CREATE TYPE "public"."application_status" AS ENUM('active', 'placed', 'rejected', 'withdrawn', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."candidate_source" AS ENUM('job_post', 'manual', 'resume_upload', 'referral', 'agency', 'linkedin', 'other');--> statement-breakpoint
CREATE TYPE "public"."candidate_status" AS ENUM('active', 'placed', 'blacklisted', 'archived');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'inactive', 'prospect', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('earned', 'topped_up', 'spent', 'refunded', 'expired', 'adjusted');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('resume', 'offer_letter', 'signed_offer', 'assessment', 'id_proof', 'contract', 'nda', 'other');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'temporary', 'internship');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'completed', 'cancelled', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."job_seeker_status" AS ENUM('active', 'inactive', 'banned');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('draft', 'published', 'paused', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."kpi_direction" AS ENUM('higher_better', 'lower_better', 'target_exact');--> statement-breakpoint
CREATE TYPE "public"."kpi_frequency" AS ENUM('daily', 'weekly', 'monthly', 'quarterly');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('trialing', 'active', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'deprecated', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."portal_application_status" AS ENUM('submitted', 'processing', 'processed', 'failed', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'submitted', 'acknowledged');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('platform', 'org', 'team');--> statement-breakpoint
CREATE TYPE "public"."stage_action_type" AS ENUM('note', 'call_log', 'email_sent', 'sms_sent', 'interview_scheduled', 'interview_completed', 'offer_letter_sent', 'offer_letter_signed', 'status_changed', 'document_uploaded', 'approval_requested', 'approval_granted', 'approval_rejected', 'candidate_contacted', 'screening_completed');--> statement-breakpoint
CREATE TYPE "public"."stage_log_status" AS ENUM('active', 'advanced', 'blocked', 'held', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."strategy_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled', 'paused');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive', 'invited', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."work_mode" AS ENUM('onsite', 'remote', 'hybrid');--> statement-breakpoint
CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"job_posting_id" uuid,
	"candidate_id" uuid NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"assigned_hr" uuid,
	"entry_source" text DEFAULT 'job_post' NOT NULL,
	"status" "application_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_stage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"moved_by" uuid,
	"status" "stage_log_status" DEFAULT 'active' NOT NULL,
	"block_reason" text,
	"notes" text,
	"stage_data" jsonb DEFAULT '{}'::jsonb,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"ip_address" text,
	"user_agent" text,
	"source_module" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"owner_team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"location" text,
	"linkedin_url" text,
	"source" "candidate_source" NOT NULL,
	"source_ref" text,
	"resume_url" text,
	"parsed_resume" jsonb,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"status" "candidate_status" DEFAULT 'active' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_team_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"owner_team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"company_name" text NOT NULL,
	"industry" text,
	"website" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"contact_role" text,
	"address" jsonb,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"shared_org_wide" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_team_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"lifetime_spent" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_account_organisation_id_unique" UNIQUE("organisation_id")
);
--> statement-breakpoint
CREATE TABLE "credit_cost" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_key" text NOT NULL,
	"action_key" text NOT NULL,
	"description" text,
	"cost" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" "credit_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"module_key" text,
	"action_key" text,
	"description" text,
	"entity_id" uuid,
	"entity_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size_bytes" text,
	"mime_type" text,
	"is_generated" text DEFAULT 'false',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_module" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error" text,
	"retry_count" text DEFAULT '0',
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"assigned_to" uuid,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid,
	"role_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "job_posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"client_id" uuid,
	"created_by" uuid NOT NULL,
	"workflow_template_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"requirements" text,
	"benefits" text,
	"location" text,
	"work_mode" "work_mode" DEFAULT 'onsite' NOT NULL,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"salary_min" text,
	"salary_max" text,
	"salary_currency" text DEFAULT 'INR',
	"required_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vacancies" integer DEFAULT 1 NOT NULL,
	"status" "job_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_seeker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"location" text,
	"resume_url" text,
	"linkedin_url" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "job_seeker_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_seeker_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "kpi_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"unit" text,
	"frequency" "kpi_frequency" DEFAULT 'monthly' NOT NULL,
	"target_value" double precision,
	"direction" "kpi_direction" DEFAULT 'higher_better' NOT NULL,
	"is_active" text DEFAULT 'true',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kpi_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"value" double precision NOT NULL,
	"period_label" text NOT NULL,
	"period_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_module_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"reason" text,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"domain" text,
	"logo_url" text,
	"status" "org_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'UTC',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "performance_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reviewee_id" uuid NOT NULL,
	"cycle" text NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb,
	"summary" text,
	"manager_notes" text,
	"submitted_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"price_monthly" numeric(10, 2),
	"price_yearly" numeric(10, 2),
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credit_allowance" integer DEFAULT 0 NOT NULL,
	"credits_enabled" boolean DEFAULT false NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "portal_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_posting_id" uuid NOT NULL,
	"job_seeker_id" uuid NOT NULL,
	"cover_letter" text,
	"resume_url" text,
	"status" "portal_application_status" DEFAULT 'submitted' NOT NULL,
	"processed_candidate_id" uuid,
	"processed_application_id" uuid,
	"processing_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" "role_scope" NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "stage_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_stage_log_id" uuid NOT NULL,
	"performed_by" uuid NOT NULL,
	"action_type" "stage_action_type" NOT NULL,
	"content" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"credit_transaction_id" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"payment_ref" text,
	"payment_provider" text DEFAULT 'stripe',
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_strategy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"period" text NOT NULL,
	"description" text,
	"objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "strategy_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"avatar_url" text,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_team_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid,
	"role_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
CREATE TABLE "workflow_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"stage_key" text NOT NULL,
	"description" text,
	"order_index" integer NOT NULL,
	"is_blockable" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"is_final_success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_job_posting_id_job_posting_id_fk" FOREIGN KEY ("job_posting_id") REFERENCES "public"."job_posting"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_workflow_template_id_workflow_template_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_assigned_hr_user_id_fk" FOREIGN KEY ("assigned_hr") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_log" ADD CONSTRAINT "application_stage_log_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_log" ADD CONSTRAINT "application_stage_log_stage_id_workflow_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."workflow_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_log" ADD CONSTRAINT "application_stage_log_moved_by_user_id_fk" FOREIGN KEY ("moved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_owner_team_id_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_team_access" ADD CONSTRAINT "candidate_team_access_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_team_access" ADD CONSTRAINT "candidate_team_access_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_team_access" ADD CONSTRAINT "candidate_team_access_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_owner_team_id_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_team_access" ADD CONSTRAINT "client_team_access_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_team_access" ADD CONSTRAINT "client_team_access_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_team_access" ADD CONSTRAINT "client_team_access_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_account" ADD CONSTRAINT "credit_account_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_credit_account_id_credit_account_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_posting" ADD CONSTRAINT "job_posting_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_posting" ADD CONSTRAINT "job_posting_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_posting" ADD CONSTRAINT "job_posting_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_posting" ADD CONSTRAINT "job_posting_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_definition" ADD CONSTRAINT "kpi_definition_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_definition" ADD CONSTRAINT "kpi_definition_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_definition" ADD CONSTRAINT "kpi_definition_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_entry" ADD CONSTRAINT "kpi_entry_kpi_id_kpi_definition_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpi_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_entry" ADD CONSTRAINT "kpi_entry_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_entry" ADD CONSTRAINT "kpi_entry_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_module_override" ADD CONSTRAINT "org_module_override_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation" ADD CONSTRAINT "organisation_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review" ADD CONSTRAINT "performance_review_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review" ADD CONSTRAINT "performance_review_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review" ADD CONSTRAINT "performance_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review" ADD CONSTRAINT "performance_review_reviewee_id_user_id_fk" FOREIGN KEY ("reviewee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_application" ADD CONSTRAINT "portal_application_job_posting_id_job_posting_id_fk" FOREIGN KEY ("job_posting_id") REFERENCES "public"."job_posting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_application" ADD CONSTRAINT "portal_application_job_seeker_id_job_seeker_id_fk" FOREIGN KEY ("job_seeker_id") REFERENCES "public"."job_seeker"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_action" ADD CONSTRAINT "stage_action_application_stage_log_id_application_stage_log_id_fk" FOREIGN KEY ("application_stage_log_id") REFERENCES "public"."application_stage_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_action" ADD CONSTRAINT "stage_action_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_strategy" ADD CONSTRAINT "team_strategy_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_strategy" ADD CONSTRAINT "team_strategy_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_strategy" ADD CONSTRAINT "team_strategy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_team_role" ADD CONSTRAINT "user_team_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_team_role" ADD CONSTRAINT "user_team_role_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_team_role" ADD CONSTRAINT "user_team_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_team_role" ADD CONSTRAINT "user_team_role_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_team_role" ADD CONSTRAINT "user_team_role_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage" ADD CONSTRAINT "workflow_stage_workflow_template_id_workflow_template_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template" ADD CONSTRAINT "workflow_template_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template" ADD CONSTRAINT "workflow_template_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template" ADD CONSTRAINT "workflow_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_org_idx" ON "application" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "app_team_idx" ON "application" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "app_candidate_idx" ON "application" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "app_job_idx" ON "application" USING btree ("job_posting_id");--> statement-breakpoint
CREATE INDEX "app_status_idx" ON "application" USING btree ("status");--> statement-breakpoint
CREATE INDEX "asl_application_idx" ON "application_stage_log" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "asl_stage_idx" ON "application_stage_log" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "asl_current_idx" ON "application_stage_log" USING btree ("application_id","exited_at");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_log" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "candidate_org_idx" ON "candidate" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "candidate_team_idx" ON "candidate" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "candidate_status_idx" ON "candidate" USING btree ("status");--> statement-breakpoint
CREATE INDEX "candidate_email_org_idx" ON "candidate" USING btree ("organisation_id","email");--> statement-breakpoint
CREATE INDEX "cand_access_candidate_idx" ON "candidate_team_access" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "cand_access_team_idx" ON "candidate_team_access" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cand_access_unique_idx" ON "candidate_team_access" USING btree ("candidate_id","team_id");--> statement-breakpoint
CREATE INDEX "client_org_idx" ON "client" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "client_team_idx" ON "client" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "client_status_idx" ON "client" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cta_client_idx" ON "client_team_access" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "cta_team_idx" ON "client_team_access" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ca_org_idx" ON "credit_account" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "cc_module_action_idx" ON "credit_cost" USING btree ("module_key","action_key");--> statement-breakpoint
CREATE INDEX "ct_org_idx" ON "credit_transaction" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "ct_account_idx" ON "credit_transaction" USING btree ("credit_account_id");--> statement-breakpoint
CREATE INDEX "ct_type_idx" ON "credit_transaction" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ct_created_idx" ON "credit_transaction" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "doc_application_idx" ON "document" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "doc_org_idx" ON "document" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "event_processed_idx" ON "event_log" USING btree ("processed","occurred_at");--> statement-breakpoint
CREATE INDEX "event_org_idx" ON "event_log" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "event_type_idx" ON "event_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "event_entity_idx" ON "event_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "goal_team_idx" ON "goal" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "goal_assigned_idx" ON "goal" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "invitation_token_idx" ON "invitation" USING btree ("token");--> statement-breakpoint
CREATE INDEX "job_org_idx" ON "job_posting" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "job_team_idx" ON "job_posting" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "job_posting" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_client_idx" ON "job_posting" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "js_email_idx" ON "job_seeker" USING btree ("email");--> statement-breakpoint
CREATE INDEX "kpi_def_team_idx" ON "kpi_definition" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "kpi_def_org_idx" ON "kpi_definition" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "kpi_entry_kpi_idx" ON "kpi_entry" USING btree ("kpi_id");--> statement-breakpoint
CREATE INDEX "kpi_entry_team_idx" ON "kpi_entry" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "kpi_entry_period_idx" ON "kpi_entry" USING btree ("kpi_id","period_date");--> statement-breakpoint
CREATE UNIQUE INDEX "org_module_unique_idx" ON "org_module_override" USING btree ("organisation_id","module_key");--> statement-breakpoint
CREATE INDEX "org_plan_idx" ON "organisation" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "org_status_idx" ON "organisation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pr_team_idx" ON "performance_review" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "pr_reviewee_idx" ON "performance_review" USING btree ("reviewee_id");--> statement-breakpoint
CREATE INDEX "pa_job_idx" ON "portal_application" USING btree ("job_posting_id");--> statement-breakpoint
CREATE INDEX "pa_seeker_idx" ON "portal_application" USING btree ("job_seeker_id");--> statement-breakpoint
CREATE INDEX "pa_status_idx" ON "portal_application" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pa_unique_application_idx" ON "portal_application" USING btree ("job_posting_id","job_seeker_id");--> statement-breakpoint
CREATE INDEX "sa_log_idx" ON "stage_action" USING btree ("application_stage_log_id");--> statement-breakpoint
CREATE INDEX "sa_performer_idx" ON "stage_action" USING btree ("performed_by");--> statement-breakpoint
CREATE INDEX "sa_type_idx" ON "stage_action" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "subscription_org_idx" ON "subscription" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "subscription_status_idx" ON "subscription" USING btree ("status");--> statement-breakpoint
CREATE INDEX "team_org_idx" ON "team" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "strategy_team_idx" ON "team_strategy" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_org_idx" ON "user" USING btree ("organisation_id","email");--> statement-breakpoint
CREATE INDEX "user_org_idx" ON "user" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "utr_user_idx" ON "user_team_role" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "utr_team_idx" ON "user_team_role" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "utr_active_unique_idx" ON "user_team_role" USING btree ("user_id","team_id","role_id");--> statement-breakpoint
CREATE INDEX "ws_template_idx" ON "workflow_stage" USING btree ("workflow_template_id");--> statement-breakpoint
CREATE INDEX "ws_order_idx" ON "workflow_stage" USING btree ("workflow_template_id","order_index");--> statement-breakpoint
CREATE INDEX "wt_org_idx" ON "workflow_template" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "wt_team_idx" ON "workflow_template" USING btree ("team_id");