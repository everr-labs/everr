CREATE TYPE "public"."alert_state" AS ENUM('unknown', 'resolved', 'firing');--> statement-breakpoint
CREATE TABLE "alert_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text NOT NULL,
	"slug" text NOT NULL,
	"evaluation_interval_seconds" integer NOT NULL,
	"document" jsonb NOT NULL,
	"parsed_query" text NOT NULL,
	"summary_template" text NOT NULL,
	"description_template" text DEFAULT '' NOT NULL,
	"next_evaluation_at" timestamp with time zone,
	"schedule_jitter_seconds" integer DEFAULT 0 NOT NULL,
	"last_enqueued_at" timestamp with time zone,
	"config_file_path" text DEFAULT '' NOT NULL,
	"source_link" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_evaluation_status" text DEFAULT '' NOT NULL,
	"last_evaluation_error" text DEFAULT '' NOT NULL,
	"current_state" "alert_state" DEFAULT 'unknown' NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"last_resolved_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_row_count" integer DEFAULT 0 NOT NULL,
	"last_evidence_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"firing_instance_count" integer DEFAULT 0 NOT NULL,
	"instance_label_columns" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"delivery" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "alert_silences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"alert_definition_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"matchers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text
);
--> statement-breakpoint
DROP INDEX "dashboards_tenant_project_slug_uq";--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "repoid" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_silences" ADD CONSTRAINT "alert_silences_alert_definition_id_alert_definitions_id_fk" FOREIGN KEY ("alert_definition_id") REFERENCES "public"."alert_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_org_repo_slug_uq" ON "alert_definitions" USING btree ("organization_id","repoid","slug");--> statement-breakpoint
CREATE INDEX "alert_definitions_due_idx" ON "alert_definitions" USING btree ("active","next_evaluation_at");--> statement-breakpoint
CREATE INDEX "alert_silences_active_lookup_idx" ON "alert_silences" USING btree ("organization_id","alert_definition_id","ends_at") WHERE cancelled_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_tenant_repo_project_slug_uq" ON "dashboards" USING btree ("organization_id","repoid","project","slug");
