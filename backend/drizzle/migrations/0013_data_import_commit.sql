-- Data import, part 3: committing a batch, and undoing it.
-- Candidates created by an import are marked source = 'import' (source_ref = the batch id).
-- Needs PostgreSQL 12+ for ADD VALUE inside a transaction.

ALTER TYPE "public"."candidate_source" ADD VALUE IF NOT EXISTS 'import';--> statement-breakpoint

ALTER TABLE "import_batch" ADD COLUMN "commit_options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "ledger" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "result" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "undone_at" timestamp with time zone;
