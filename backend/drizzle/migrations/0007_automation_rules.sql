CREATE TABLE "automation_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"trigger_key" text NOT NULL,
	"target_stage_key" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ar_org_idx" ON "automation_rule" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ar_one_per_trigger" ON "automation_rule" USING btree ("organisation_id","trigger","trigger_key");