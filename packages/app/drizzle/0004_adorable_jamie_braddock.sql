CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"topic" text NOT NULL DEFAULT 'collector',
	"body_sha256" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"headers" jsonb NOT NULL,
	"body" bytea NOT NULL,
	"tenant_id" bigint,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"error_class" text,
	"done_at" timestamp with time zone,
	"dead_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "webhook_events"
	ADD COLUMN IF NOT EXISTS "topic" text NOT NULL DEFAULT 'collector',
	ADD COLUMN IF NOT EXISTS "tenant_id" bigint,
	ADD COLUMN IF NOT EXISTS "headers" jsonb,
	ADD COLUMN IF NOT EXISTS "body" bytea,
	ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'queued',
	ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
	ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "last_error" text,
	ADD COLUMN IF NOT EXISTS "error_class" text,
	ADD COLUMN IF NOT EXISTS "done_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "dead_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "webhook_events" DROP CONSTRAINT IF EXISTS "webhook_events_source_event_id_key";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_source_event_id_topic_key" ON "webhook_events" USING btree ("source","event_id","topic");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_claim_idx" ON "webhook_events" USING btree ("next_attempt_at","received_at") WHERE "webhook_events"."status" in ('queued', 'failed');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_dead_idx" ON "webhook_events" USING btree ("dead_at") WHERE "webhook_events"."status" = 'dead';
