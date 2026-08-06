DROP TABLE "alert_silences";--> statement-breakpoint
DROP TABLE "alert_definitions";--> statement-breakpoint
DROP TABLE "alert_settings";--> statement-breakpoint
CREATE TYPE "public"."alert_delivery_state" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."alert_event_type" AS ENUM('instance_fired', 'instance_resolved', 'delivery', 'rule_health', 'silenced');--> statement-breakpoint
CREATE TYPE "public"."alert_health" AS ENUM('healthy', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."alert_instance_state" AS ENUM('inactive', 'pending', 'firing');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_source_kind" AS ENUM('alert', 'slo');--> statement-breakpoint
CREATE TABLE "alert_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text NOT NULL,
	"preview_id" uuid,
	"slug" text NOT NULL,
	"project" text DEFAULT 'default' NOT NULL,
	"spec" jsonb NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"next_evaluation_at" timestamp with time zone,
	"last_enqueued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_error" text,
	"current_state" "alert_state" DEFAULT 'unknown' NOT NULL,
	"health_status" "alert_health" DEFAULT 'healthy' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"degraded_since" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_evaluated_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"last_resolved_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_row_count" integer DEFAULT 0 NOT NULL,
	"firing_instance_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "alert_definitions_repoid_nonempty" CHECK (length("alert_definitions"."repoid") > 0),
	CONSTRAINT "alert_definitions_project_nonempty" CHECK (length("alert_definitions"."project") > 0),
	CONSTRAINT "alert_definitions_slug_nonempty" CHECK (length("alert_definitions"."slug") > 0),
	CONSTRAINT "alert_definitions_version_positive" CHECK ("alert_definitions"."version" > 0),
	CONSTRAINT "alert_definitions_failures_nonnegative" CHECK ("alert_definitions"."consecutive_failures" >= 0),
	CONSTRAINT "alert_definitions_row_count_nonnegative" CHECK ("alert_definitions"."last_row_count" >= 0),
	CONSTRAINT "alert_definitions_firing_count_nonnegative" CHECK ("alert_definitions"."firing_instance_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "alert_silences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"matchers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_silences_valid_window" CHECK ("alert_silences"."ends_at" > "alert_silences"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_config" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"dedup_key" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"notification_group_id" uuid,
	"channel_id" uuid NOT NULL,
	"channel_name" text NOT NULL,
	"notification" jsonb NOT NULL,
	"status" "alert_delivery_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_deliveries_attempts_nonnegative" CHECK ("alert_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "alert_delivery_events" (
	"organization_id" text NOT NULL,
	"delivery_dedup_key" text NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "alert_delivery_events_delivery_dedup_key_event_id_pk" PRIMARY KEY("delivery_dedup_key","event_id")
);
--> statement-breakpoint
CREATE TABLE "alert_evaluations" (
	"alert_definition_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	CONSTRAINT "alert_evaluations_alert_definition_id_scheduled_for_pk" PRIMARY KEY("alert_definition_id","scheduled_for")
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text NOT NULL,
	"preview_id" uuid,
	"source_kind" "alert_source_kind" NOT NULL,
	"source_definition_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"event_type" "alert_event_type" NOT NULL,
	"instance_fingerprint" text DEFAULT '' NOT NULL,
	"instance_labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"severity" "alert_severity" DEFAULT 'info' NOT NULL,
	"notification_title" text DEFAULT '' NOT NULL,
	"notification_description" text DEFAULT '' NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"silenced" boolean DEFAULT false NOT NULL,
	"inhibited" boolean DEFAULT false NOT NULL,
	"silence_id" uuid,
	"evidence" jsonb,
	"evidence_truncated" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "alert_events_repoid_nonempty" CHECK (length("alert_events"."repoid") > 0)
);
--> statement-breakpoint
CREATE TABLE "alert_inhibitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"alert_definition_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "alert_instance_state" DEFAULT 'inactive' NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"value" double precision,
	"pending_since" timestamp with time zone,
	"active_since" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"absent_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_instances_absent_count_nonnegative" CHECK ("alert_instances"."absent_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "alert_notification_group_events" (
	"organization_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "alert_notification_group_events_group_id_event_id_pk" PRIMARY KEY("group_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "alert_notification_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"group_key" text NOT NULL,
	"receiver_id" uuid NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_flush_at" timestamp with time zone NOT NULL,
	"last_flushed_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"repeat_interval_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_notification_groups_repeat_interval_valid" CHECK ("alert_notification_groups"."repeat_interval_seconds" IS NULL OR "alert_notification_groups"."repeat_interval_seconds" >= 60)
);
--> statement-breakpoint
CREATE TABLE "alert_receiver_channels" (
	"organization_id" text NOT NULL,
	"receiver_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "alert_receiver_channels_receiver_id_channel_id_pk" PRIMARY KEY("receiver_id","channel_id"),
	CONSTRAINT "alert_receiver_channels_position_nonnegative" CHECK ("alert_receiver_channels"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "alert_receivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"receiver_id" uuid NOT NULL,
	"priority" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slo_alert_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"slo_definition_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"status" "alert_instance_state" DEFAULT 'inactive' NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"value" double precision,
	"active_since" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slo_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text NOT NULL,
	"preview_id" uuid,
	"project" text DEFAULT 'default' NOT NULL,
	"slug" text NOT NULL,
	"spec" jsonb NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"next_evaluation_at" timestamp with time zone NOT NULL,
	"last_enqueued_at" timestamp with time zone,
	"health_status" "alert_health" DEFAULT 'healthy' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"degraded_since" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"budget_epoch" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb,
	"status_computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slo_definitions_repoid_nonempty" CHECK (length("slo_definitions"."repoid") > 0),
	CONSTRAINT "slo_definitions_project_nonempty" CHECK (length("slo_definitions"."project") > 0),
	CONSTRAINT "slo_definitions_slug_nonempty" CHECK (length("slo_definitions"."slug") > 0),
	CONSTRAINT "slo_definitions_version_positive" CHECK ("slo_definitions"."version" > 0),
	CONSTRAINT "slo_definitions_failures_nonnegative" CHECK ("slo_definitions"."consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "slo_evaluations" (
	"slo_definition_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	CONSTRAINT "slo_evaluations_slo_definition_id_scheduled_for_pk" PRIMARY KEY("slo_definition_id","scheduled_for")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "previews_id_tenant_uq" ON "previews" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "previews_id_tenant_repo_uq" ON "previews" USING btree ("id","organization_id","repoid");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_org_id_uq" ON "alert_definitions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_org_id_uq" ON "alert_channels" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_deliveries_org_key_uq" ON "alert_deliveries" USING btree ("organization_id","dedup_key");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_org_id_uq" ON "alert_events" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_notification_groups_org_id_uq" ON "alert_notification_groups" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_receivers_org_id_uq" ON "alert_receivers" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slo_definitions_org_id_uq" ON "slo_definitions" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD CONSTRAINT "alert_definitions_preview_tenant_fk" FOREIGN KEY ("preview_id","organization_id","repoid") REFERENCES "public"."previews"("id","organization_id","repoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_notification_group_id_alert_notification_groups_id_fk" FOREIGN KEY ("notification_group_id") REFERENCES "public"."alert_notification_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_channel_tenant_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."alert_channels"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_delivery_events" ADD CONSTRAINT "alert_delivery_events_organization_id_delivery_dedup_key_alert_deliveries_organization_id_dedup_key_fk" FOREIGN KEY ("organization_id","delivery_dedup_key") REFERENCES "public"."alert_deliveries"("organization_id","dedup_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_delivery_events" ADD CONSTRAINT "alert_delivery_events_organization_id_event_id_alert_events_organization_id_id_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."alert_events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_evaluations" ADD CONSTRAINT "alert_evaluations_alert_definition_id_alert_definitions_id_fk" FOREIGN KEY ("alert_definition_id") REFERENCES "public"."alert_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_preview_tenant_fk" FOREIGN KEY ("preview_id","organization_id","repoid") REFERENCES "public"."previews"("id","organization_id","repoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_instances" ADD CONSTRAINT "alert_instances_definition_tenant_fk" FOREIGN KEY ("organization_id","alert_definition_id") REFERENCES "public"."alert_definitions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_notification_group_events" ADD CONSTRAINT "alert_notification_group_events_organization_id_group_id_alert_notification_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."alert_notification_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_notification_group_events" ADD CONSTRAINT "alert_notification_group_events_organization_id_event_id_alert_events_organization_id_id_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."alert_events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_notification_groups" ADD CONSTRAINT "alert_notification_groups_receiver_tenant_fk" FOREIGN KEY ("organization_id","receiver_id") REFERENCES "public"."alert_receivers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_receiver_channels" ADD CONSTRAINT "alert_receiver_channels_organization_id_receiver_id_alert_receivers_organization_id_id_fk" FOREIGN KEY ("organization_id","receiver_id") REFERENCES "public"."alert_receivers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_receiver_channels" ADD CONSTRAINT "alert_receiver_channels_organization_id_channel_id_alert_channels_organization_id_id_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."alert_channels"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_routes" ADD CONSTRAINT "alert_routes_organization_id_receiver_id_alert_receivers_organization_id_id_fk" FOREIGN KEY ("organization_id","receiver_id") REFERENCES "public"."alert_receivers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slo_alert_instances" ADD CONSTRAINT "slo_alert_instances_definition_tenant_fk" FOREIGN KEY ("organization_id","slo_definition_id") REFERENCES "public"."slo_definitions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slo_definitions" ADD CONSTRAINT "slo_definitions_preview_tenant_fk" FOREIGN KEY ("preview_id","organization_id","repoid") REFERENCES "public"."previews"("id","organization_id","repoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slo_evaluations" ADD CONSTRAINT "slo_evaluations_slo_definition_id_slo_definitions_id_fk" FOREIGN KEY ("slo_definition_id") REFERENCES "public"."slo_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_org_name_uq" ON "alert_channels" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "alert_deliveries_org_idx" ON "alert_deliveries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "alert_deliveries_terminal_cleanup_idx" ON "alert_deliveries" USING btree ("updated_at","dedup_key") WHERE "alert_deliveries"."status" = 'sent' OR ("alert_deliveries"."status" = 'failed' AND "alert_deliveries"."attempts" >= 5);--> statement-breakpoint
CREATE INDEX "alert_delivery_events_event_idx" ON "alert_delivery_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "alert_evaluations_scheduled_idx" ON "alert_evaluations" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "alert_events_org_occurred_idx" ON "alert_events" USING btree ("organization_id",occurred_at DESC);--> statement-breakpoint
CREATE INDEX "alert_events_org_fingerprint_idx" ON "alert_events" USING btree ("organization_id","instance_fingerprint",occurred_at DESC);--> statement-breakpoint
CREATE INDEX "alert_events_org_slug_idx" ON "alert_events" USING btree ("organization_id","slug",occurred_at DESC);--> statement-breakpoint
CREATE INDEX "alert_events_processed_idx" ON "alert_events" USING btree ("processed_at","id") WHERE "alert_events"."processed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_inhibitions_org_idx" ON "alert_inhibitions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_instances_definition_fingerprint_uq" ON "alert_instances" USING btree ("alert_definition_id","fingerprint");--> statement-breakpoint
CREATE INDEX "alert_instances_org_updated_idx" ON "alert_instances" USING btree ("organization_id",updated_at DESC);--> statement-breakpoint
CREATE INDEX "alert_instances_org_firing_idx" ON "alert_instances" USING btree ("organization_id",updated_at DESC) WHERE "alert_instances"."status" = 'firing';--> statement-breakpoint
CREATE INDEX "alert_notification_group_events_event_idx" ON "alert_notification_group_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_notification_groups_org_key_uq" ON "alert_notification_groups" USING btree ("organization_id","group_key");--> statement-breakpoint
CREATE INDEX "alert_notification_groups_cleanup_idx" ON "alert_notification_groups" USING btree ("updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_receiver_channels_receiver_position_uq" ON "alert_receiver_channels" USING btree ("receiver_id","position");--> statement-breakpoint
CREATE INDEX "alert_receiver_channels_channel_idx" ON "alert_receiver_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_receivers_org_name_uq" ON "alert_receivers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "alert_routes_org_receiver_idx" ON "alert_routes" USING btree ("organization_id","receiver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slo_alert_instances_slo_tier_uq" ON "slo_alert_instances" USING btree ("slo_definition_id","tier");--> statement-breakpoint
CREATE INDEX "slo_alert_instances_org_updated_idx" ON "slo_alert_instances" USING btree ("organization_id",updated_at DESC);--> statement-breakpoint
CREATE INDEX "slo_alert_instances_org_firing_idx" ON "slo_alert_instances" USING btree ("organization_id",updated_at DESC) WHERE "slo_alert_instances"."status" = 'firing';--> statement-breakpoint
CREATE UNIQUE INDEX "slo_definitions_live_project_slug_uq" ON "slo_definitions" USING btree ("organization_id","project","slug") WHERE "slo_definitions"."preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "slo_definitions_preview_project_slug_uq" ON "slo_definitions" USING btree ("preview_id","project","slug") WHERE "slo_definitions"."preview_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "slo_definitions_due_idx" ON "slo_definitions" USING btree ("paused","next_evaluation_at");--> statement-breakpoint
CREATE INDEX "slo_evaluations_scheduled_idx" ON "slo_evaluations" USING btree ("scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_live_project_slug_uq" ON "alert_definitions" USING btree ("organization_id","project","slug") WHERE "alert_definitions"."preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_preview_project_slug_uq" ON "alert_definitions" USING btree ("preview_id","project","slug") WHERE "alert_definitions"."preview_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_definitions_due_idx" ON "alert_definitions" USING btree ("active","next_evaluation_at");--> statement-breakpoint
CREATE INDEX "alert_silences_cleanup_idx" ON "alert_silences" USING btree ("ends_at","id");--> statement-breakpoint
CREATE INDEX "alert_silences_active_lookup_idx" ON "alert_silences" USING btree ("organization_id","ends_at");--> statement-breakpoint
