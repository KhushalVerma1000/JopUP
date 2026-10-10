CREATE TYPE "public"."spoc_mail_role" AS ENUM('to', 'cc');--> statement-breakpoint
CREATE TABLE "client_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"tracker_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "client_mail_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"location_id" uuid,
	"template_id" uuid,
	"sent_by" uuid NOT NULL,
	"subject" text NOT NULL,
	"to_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tracker_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "client_spoc" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "client_spoc" ADD COLUMN "mail_role" "spoc_mail_role" DEFAULT 'to' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_location" ADD CONSTRAINT "client_location_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_location" ADD CONSTRAINT "client_location_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_location" ADD CONSTRAINT "client_location_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_location" ADD CONSTRAINT "client_location_tracker_template_id_tracker_template_id_fk" FOREIGN KEY ("tracker_template_id") REFERENCES "public"."tracker_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_mail_log" ADD CONSTRAINT "client_mail_log_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_mail_log" ADD CONSTRAINT "client_mail_log_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_mail_log" ADD CONSTRAINT "client_mail_log_location_id_client_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."client_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_mail_log" ADD CONSTRAINT "client_mail_log_template_id_tracker_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."tracker_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_mail_log" ADD CONSTRAINT "client_mail_log_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_spoc" ADD CONSTRAINT "client_spoc_location_id_client_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."client_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloc_org_idx" ON "client_location" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "cloc_client_idx" ON "client_location" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "cml_org_idx" ON "client_mail_log" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "cml_client_idx" ON "client_mail_log" USING btree ("client_id","sent_at");--> statement-breakpoint
CREATE INDEX "spoc_location_idx" ON "client_spoc" USING btree ("location_id");
