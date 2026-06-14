DROP INDEX "alert_silences_active_lookup_idx";--> statement-breakpoint
ALTER TABLE "alert_definitions" ALTER COLUMN "window" SET DEFAULT '';--> statement-breakpoint
CREATE INDEX "alert_silences_active_lookup_idx" ON "alert_silences" USING btree ("organization_id","alert_definition_id","ends_at") WHERE cancelled_at IS NULL;