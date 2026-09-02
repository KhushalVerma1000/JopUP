ALTER TYPE "public"."user_status" ADD VALUE 'pending_approval' BEFORE 'suspended';--> statement-breakpoint
ALTER TYPE "public"."user_status" ADD VALUE 'rejected' BEFORE 'suspended';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "requested_team_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "requested_role_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "requested_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_requested_team_id_team_id_fk" FOREIGN KEY ("requested_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_requested_role_id_role_id_fk" FOREIGN KEY ("requested_role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_requested_manager_id_user_id_fk" FOREIGN KEY ("requested_manager_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_rejected_by_user_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_status_idx" ON "user" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_requested_manager_idx" ON "user" USING btree ("requested_manager_id");