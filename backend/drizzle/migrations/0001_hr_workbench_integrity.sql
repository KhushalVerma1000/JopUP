-- Hand-added: make this migration safe on databases that already contain the
-- duplicates the new indexes forbid (both arose from concurrent requests).
-- Oldest row wins; later duplicates are demoted rather than deleted.

-- Teams with several default workflow templates: keep the oldest as default.
UPDATE "workflow_template" SET "is_default" = false
WHERE "is_default" = true AND "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "team_id" ORDER BY "created_at", "id") AS rn
    FROM "workflow_template" WHERE "is_default" = true
  ) d WHERE d.rn > 1
);--> statement-breakpoint

-- A candidate tagged more than once to the same position while still live:
-- keep the oldest, mark the rest withdrawn (they then show under Closed).
UPDATE "candidate_tracker" SET "status" = 'withdrawn', "updated_at" = now()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "candidate_id", "open_position_id" ORDER BY "created_at", "id") AS rn
    FROM "candidate_tracker"
    WHERE "open_position_id" IS NOT NULL AND "status" IN ('active', 'on_hold')
  ) d WHERE d.rn > 1
);--> statement-breakpoint

CREATE UNIQUE INDEX "ctr_one_live_tag_uq" ON "candidate_tracker" USING btree ("candidate_id","open_position_id") WHERE "candidate_tracker"."open_position_id" is not null and "candidate_tracker"."status" in ('active', 'on_hold');--> statement-breakpoint
CREATE UNIQUE INDEX "wt_one_default_per_team" ON "workflow_template" USING btree ("team_id") WHERE "workflow_template"."is_default" = true;