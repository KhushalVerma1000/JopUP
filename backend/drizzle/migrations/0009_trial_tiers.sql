-- HireTracker trials: 30 days for everyone, 90 days only for companies a platform admin selected.
-- Existing organisations keep the trial_ends_at they already have (nobody loses days).
ALTER TABLE "organisation" ADD COLUMN "trial_tier" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "trial_extended_by" uuid;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "trial_extended_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "trial_selection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"claimed_org_id" uuid,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "trial_selection" ADD CONSTRAINT "trial_selection_claimed_org_id_organisation_id_fk" FOREIGN KEY ("claimed_org_id") REFERENCES "public"."organisation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_selection_match_idx" ON "trial_selection" USING btree ("match");--> statement-breakpoint
CREATE INDEX "trial_selection_claimed_idx" ON "trial_selection" USING btree ("claimed_org_id");--> statement-breakpoint
-- Orgs that already run past 30 days from signup were given the old 90-day trial: mark them extended.
UPDATE "organisation" SET "trial_tier" = 'extended' WHERE "status" = 'trialing' AND "trial_ends_at" > "created_at" + interval '31 days';--> statement-breakpoint
-- Plan rows show this number on the signup page; signup itself no longer reads it.
UPDATE "plan" SET "trial_days" = 30;
