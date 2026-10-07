-- Auto metrics: KPIs, goals and strategy key results can be computed from the
-- pipeline instead of typed in. Everything here is additive and idempotent.

ALTER TABLE "kpi_definition" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "kpi_definition" ADD COLUMN IF NOT EXISTS "metric_key" text;--> statement-breakpoint

-- Readings written by the system have no recording user.
ALTER TABLE "kpi_entry" ALTER COLUMN "recorded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kpi_entry" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "kpi_entry" ADD COLUMN IF NOT EXISTS "computed_value" double precision;--> statement-breakpoint
ALTER TABLE "kpi_entry" ADD COLUMN IF NOT EXISTS "override_reason" text;--> statement-breakpoint
ALTER TABLE "kpi_entry" ADD COLUMN IF NOT EXISTS "computed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kpi_entry" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "goal" ADD COLUMN IF NOT EXISTS "progress_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN IF NOT EXISTS "metric_key" text;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN IF NOT EXISTS "target_value" double precision;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN IF NOT EXISTS "start_date" date;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN IF NOT EXISTS "current_value" double precision;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN IF NOT EXISTS "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN IF NOT EXISTS "finalized_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "team_strategy" ADD COLUMN IF NOT EXISTS "period_start" date;--> statement-breakpoint
ALTER TABLE "team_strategy" ADD COLUMN IF NOT EXISTS "period_end" date;--> statement-breakpoint
ALTER TABLE "team_strategy" ADD COLUMN IF NOT EXISTS "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_strategy" ADD COLUMN IF NOT EXISTS "retrospective" text;
