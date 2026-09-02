ALTER TABLE "alert_definitions" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD COLUMN "paused_by_principal" text;--> statement-breakpoint
CREATE INDEX "alert_events_org_definition_kind_idx" ON "alert_events" USING btree ("organization_id","source_definition_id","kind",occurred_at DESC);--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD CONSTRAINT "alert_definitions_pause_trail_complete" CHECK (("alert_definitions"."paused_at" IS NULL) = ("alert_definitions"."paused_by_principal" IS NULL));