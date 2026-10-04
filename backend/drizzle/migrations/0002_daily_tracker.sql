CREATE TYPE "public"."daily_tracker_run_status" AS ENUM('running', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."daily_tracker_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TABLE "daily_tracker_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"tracker_date" date NOT NULL,
	"trigger" "daily_tracker_trigger" NOT NULL,
	"status" "daily_tracker_run_status" DEFAULT 'running' NOT NULL,
	"tracker_id" uuid,
	"email_message_id" uuid,
	"row_count" integer DEFAULT 0 NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"triggered_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_tracker_schedule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"client_id" uuid,
	"created_by" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"send_time" text DEFAULT '18:00' NOT NULL,
	"timezone" text,
	"send_days" jsonb DEFAULT '[1,2,3,4,5,6]'::jsonb NOT NULL,
	"skip_if_empty" boolean DEFAULT true NOT NULL,
	"to_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"include_client_contacts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_tracker_run" ADD CONSTRAINT "daily_tracker_run_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tracker_run" ADD CONSTRAINT "daily_tracker_run_schedule_id_daily_tracker_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."daily_tracker_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tracker_run" ADD CONSTRAINT "daily_tracker_run_tracker_id_tracker_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."tracker"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tracker_run" ADD CONSTRAINT "daily_tracker_run_email_message_id_email_message_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tracker_run" ADD CONSTRAINT "daily_tracker_run_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tracker_schedule" ADD CONSTRAINT "daily_tracker_schedule_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tracker_schedule" ADD CONSTRAINT "daily_tracker_schedule_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tracker_schedule" ADD CONSTRAINT "daily_tracker_schedule_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tracker_schedule" ADD CONSTRAINT "daily_tracker_schedule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dtr_schedule_date_idx" ON "daily_tracker_run" USING btree ("schedule_id","tracker_date");--> statement-breakpoint
CREATE INDEX "dtr_org_idx" ON "daily_tracker_run" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dtr_one_scheduled_per_day" ON "daily_tracker_run" USING btree ("schedule_id","tracker_date") WHERE "daily_tracker_run"."trigger" = 'scheduled' and "daily_tracker_run"."status" <> 'failed';--> statement-breakpoint
CREATE INDEX "dts_org_idx" ON "daily_tracker_schedule" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "dts_team_idx" ON "daily_tracker_schedule" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "dts_due_idx" ON "daily_tracker_schedule" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "dts_one_per_team_client" ON "daily_tracker_schedule" USING btree ("team_id","client_id") WHERE "daily_tracker_schedule"."client_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "dts_one_internal_per_team" ON "daily_tracker_schedule" USING btree ("team_id") WHERE "daily_tracker_schedule"."client_id" is null;