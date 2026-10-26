CREATE TABLE "usage_counter" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_counter" ADD CONSTRAINT "usage_counter_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counter_unique_idx" ON "usage_counter" USING btree ("organisation_id","key","period_start");--> statement-breakpoint
CREATE INDEX "usage_counter_org_idx" ON "usage_counter" USING btree ("organisation_id");--> statement-breakpoint
-- HireTracker trial: 3 months, resume parsing free but capped at 500 per month
-- (3 x 500 = 1500 over the trial). Applies to plans that already exist; the
-- seed carries the same values for fresh databases.
UPDATE "plan"
SET "trial_days" = 90,
    "limits" = COALESCE("limits", '{}'::jsonb) || '{"trial_resume_parses_per_month": 500}'::jsonb;
--> statement-breakpoint
-- Resume parsing is no longer priced in credits.
UPDATE "credit_cost" SET "active" = false WHERE "module_key" = 'candidate_db' AND "action_key" = 'resume_parse';
