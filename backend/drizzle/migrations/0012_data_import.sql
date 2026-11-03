-- Data import, part 2: staged batches. A batch is an uploaded spreadsheet taken as far as a reviewed plan.
-- Nothing here writes to candidates, clients or trackers; committing is a later step.
-- Rows carry personal data, so every batch has an expiry for a purge job to act on.

CREATE TYPE "public"."import_batch_status" AS ENUM('previewed', 'importing', 'done', 'failed', 'undone');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('pending', 'done', 'skipped', 'failed');--> statement-breakpoint

CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" "import_batch_status" DEFAULT 'previewed' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "import_row" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"sheet_name" text NOT NULL,
	"row_number" integer NOT NULL,
	"data" jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "import_row_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text
);--> statement-breakpoint

ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "ib_org_idx" ON "import_batch" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "ib_team_idx" ON "import_batch" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ib_expires_idx" ON "import_batch" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ir_batch_seq_uq" ON "import_row" USING btree ("batch_id","seq");--> statement-breakpoint
CREATE INDEX "ir_batch_status_idx" ON "import_row" USING btree ("batch_id","status");
