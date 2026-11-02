-- Plan tiers: Starter is the entry plan everyone trials on; Pro is tasted through a time-boxed preview;
-- Enterprise is requested by email. Existing workspaces keep the plan, modules and credits they already have.

-- 1. Which plans can be started without asking.
ALTER TABLE "plan" ADD COLUMN "self_serve" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "plan" SET "self_serve" = false WHERE "slug" = 'enterprise';--> statement-breakpoint

-- 2. The taste, kept in plan config so it can be tuned without a deploy:
--    14 days of Pro modules from signup, then a locked preview; 50 starting credits instead of the full allowance.
UPDATE "plan"
SET "limits" = COALESCE("limits", '{}'::jsonb) || '{"trial_credits": 50, "trial_preview_days": 14, "trial_preview_plan": "pro"}'::jsonb
WHERE "slug" = 'starter';--> statement-breakpoint

-- 3. Credits an approved Enterprise trial starts with.
UPDATE "plan"
SET "limits" = COALESCE("limits", '{}'::jsonb) || '{"trial_credits": 200}'::jsonb
WHERE "slug" = 'enterprise';--> statement-breakpoint

-- 4. Requests for Enterprise trials and Pro upgrades.
CREATE TABLE "trial_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requested_plan" text DEFAULT 'enterprise' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"phone" text,
	"team_size" text,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"organisation_id" uuid,
	"trial_days" integer,
	"decision_note" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "trial_request" ADD CONSTRAINT "trial_request_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trial_request_status_idx" ON "trial_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "trial_request_email_idx" ON "trial_request" USING btree ("email");
