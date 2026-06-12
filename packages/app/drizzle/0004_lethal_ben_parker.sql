ALTER TABLE "alert_definitions" ADD COLUMN "firing_instance_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD COLUMN "instance_label_columns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_silences" ADD COLUMN "matchers" jsonb DEFAULT '[]'::jsonb NOT NULL;