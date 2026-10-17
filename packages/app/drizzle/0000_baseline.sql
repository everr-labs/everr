CREATE TYPE "public"."alert_delivery_state" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."alert_event_kind" AS ENUM('notifying', 'state');--> statement-breakpoint
CREATE TYPE "public"."alert_event_type" AS ENUM('instance_pending', 'instance_fired', 'instance_resolved', 'instance_closed', 'evaluation_failed');--> statement-breakpoint
CREATE TYPE "public"."alert_instance_state" AS ENUM('inactive', 'pending', 'firing');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_state" AS ENUM('unknown', 'resolved', 'pending', 'firing');--> statement-breakpoint
CREATE TYPE "public"."installation_status" AS ENUM('active', 'suspended', 'uninstalled');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('requested', 'waiting', 'queued', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_config" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "alert_default_channels" (
	"organization_id" text NOT NULL,
	"tier" text NOT NULL,
	"channel_id" uuid NOT NULL,
	CONSTRAINT "alert_default_channels_organization_id_tier_channel_id_pk" PRIMARY KEY("organization_id","tier","channel_id")
);--> statement-breakpoint
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
	"paused_at" timestamp with time zone,
	"paused_by_principal" text,
	"paused_by" text,
	"last_error" text,
	"current_state" "alert_state" DEFAULT 'unknown' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"degraded_since" timestamp with time zone,
	"last_error_at" timestamp with time zone,
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
	CONSTRAINT "alert_definitions_firing_count_nonnegative" CHECK ("alert_definitions"."firing_instance_count" >= 0),
	CONSTRAINT "alert_definitions_pause_trail_complete" CHECK (("alert_definitions"."paused_at" IS NULL) = ("alert_definitions"."paused_by_principal" IS NULL))
);--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"dedup_key" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"notification_group_id" uuid,
	"channel_id" uuid,
	"channel_name" text NOT NULL,
	"notification" jsonb NOT NULL,
	"status" "alert_delivery_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_deliveries_attempts_nonnegative" CHECK ("alert_deliveries"."attempts" >= 0)
);--> statement-breakpoint
CREATE TABLE "alert_delivery_events" (
	"organization_id" text NOT NULL,
	"delivery_dedup_key" text NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "alert_delivery_events_delivery_dedup_key_event_id_pk" PRIMARY KEY("delivery_dedup_key","event_id")
);--> statement-breakpoint
CREATE TABLE "alert_evaluations" (
	"alert_definition_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	CONSTRAINT "alert_evaluations_alert_definition_id_scheduled_for_pk" PRIMARY KEY("alert_definition_id","scheduled_for")
);--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text NOT NULL,
	"preview_id" uuid,
	"source_definition_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"event_type" "alert_event_type" NOT NULL,
	"kind" "alert_event_kind" DEFAULT 'notifying' NOT NULL,
	"episode_id" uuid,
	"reason" text DEFAULT '' NOT NULL,
	"instance_fingerprint" text DEFAULT '' NOT NULL,
	"instance_labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"severity" "alert_severity" DEFAULT 'info' NOT NULL,
	"notification_title" text DEFAULT '' NOT NULL,
	"notification_description" text DEFAULT '' NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"silence_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "alert_events_repoid_nonempty" CHECK (length("alert_events"."repoid") > 0),
	CONSTRAINT "alert_events_kind_matches_type" CHECK (("alert_events"."event_type" NOT IN ('instance_pending', 'instance_closed', 'evaluation_failed') OR "alert_events"."kind" = 'state') AND ("alert_events"."event_type" NOT IN ('instance_fired', 'instance_resolved') OR "alert_events"."kind" = 'notifying')),
	CONSTRAINT "alert_events_reason_in_vocabulary" CHECK ("alert_events"."reason" IN ('', 'condition_cleared', 'pending_cleared', 'labels_changed', 'rule_paused', 'rule_deleted', 'preview_deleted', 'no_longer_firing', 'no_channels'))
);--> statement-breakpoint
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
	"episode_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_instances_absent_count_nonnegative" CHECK ("alert_instances"."absent_count" >= 0)
);--> statement-breakpoint
CREATE TABLE "alert_notification_group_events" (
	"organization_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"flushed_at" timestamp with time zone,
	CONSTRAINT "alert_notification_group_events_group_id_event_id_pk" PRIMARY KEY("group_id","event_id")
);--> statement-breakpoint
CREATE TABLE "alert_notification_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"group_key" text NOT NULL,
	"default_tier" text,
	"direct_alert_definition_id" uuid,
	"next_flush_at" timestamp with time zone NOT NULL,
	"last_flushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_notification_groups_one_target" CHECK (num_nonnulls("alert_notification_groups"."default_tier", "alert_notification_groups"."direct_alert_definition_id") = 1)
);--> statement-breakpoint
CREATE TABLE "alert_silences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"matchers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"author_principal" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "alert_silences_valid_window" CHECK ("alert_silences"."ends_at" >= "alert_silences"."starts_at")
);--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text,
	"preview_id" uuid,
	"project" text NOT NULL,
	"slug" text NOT NULL,
	"folder_path" text DEFAULT '' NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboards_live_xor_preview" CHECK (("dashboards"."preview_id" IS NULL) <> ("dashboards"."repoid" IS NULL))
);--> statement-breakpoint
CREATE TABLE "github_installation_organizations" (
	"github_installation_id" bigint PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" "installation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text NOT NULL,
	"name" text NOT NULL,
	"last_applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "runbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text,
	"preview_id" uuid,
	"project" text NOT NULL,
	"slug" text NOT NULL,
	"folder_path" text DEFAULT '' NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runbooks_live_xor_preview" CHECK (("runbooks"."preview_id" IS NULL) <> ("runbooks"."repoid" IS NULL))
);--> statement-breakpoint
CREATE TABLE "workflow_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" text NOT NULL,
	"job_id" bigint NOT NULL,
	"run_id" bigint NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"trace_id" text NOT NULL,
	"job_name" text NOT NULL,
	"repository" text NOT NULL,
	"sha" text NOT NULL,
	"ref" text NOT NULL,
	"status" "workflow_status" NOT NULL,
	"conclusion" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" text NOT NULL,
	"run_id" bigint NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"trace_id" text NOT NULL,
	"workflow_name" text NOT NULL,
	"repository" text NOT NULL,
	"sha" text NOT NULL,
	"ref" text NOT NULL,
	"status" "workflow_status" NOT NULL,
	"conclusion" text,
	"author_email" text,
	"run_started_at" timestamp with time zone,
	"run_completed_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);--> statement-breakpoint
CREATE TABLE "device_code" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text
);--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp
);--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"refresh_id" text,
	"expires_at" timestamp,
	"created_at" timestamp,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_access_token_token_unique" UNIQUE("token")
);--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"token_endpoint_auth_method" text,
	"grant_types" text[],
	"response_types" text[],
	"public" boolean,
	"type" text,
	"require_pkce" boolean,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauth_client_client_id_unique" UNIQUE("client_id")
);--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"scopes" text[] NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"auth_time" timestamp,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_refresh_token_token_unique" UNIQUE("token")
);--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_org_name_uq" ON "alert_channels" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_org_id_uq" ON "alert_channels" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "alert_default_channels_channel_idx" ON "alert_default_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_live_project_slug_uq" ON "alert_definitions" USING btree ("organization_id","project","slug") WHERE "alert_definitions"."preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_preview_project_slug_uq" ON "alert_definitions" USING btree ("preview_id","project","slug") WHERE "alert_definitions"."preview_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_org_id_uq" ON "alert_definitions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "alert_definitions_due_idx" ON "alert_definitions" USING btree ("active","next_evaluation_at");--> statement-breakpoint
CREATE INDEX "alert_definitions_org_updated_idx" ON "alert_definitions" USING btree ("organization_id",updated_at DESC,id DESC);--> statement-breakpoint
CREATE INDEX "alert_deliveries_org_channel_inflight_idx" ON "alert_deliveries" USING btree ("organization_id","channel_id") WHERE "alert_deliveries"."status" = 'pending' OR ("alert_deliveries"."status" = 'failed' AND "alert_deliveries"."attempts" < 5);--> statement-breakpoint
CREATE INDEX "alert_deliveries_terminal_cleanup_idx" ON "alert_deliveries" USING btree ("updated_at","dedup_key") WHERE "alert_deliveries"."status" = 'sent' OR ("alert_deliveries"."status" = 'failed' AND "alert_deliveries"."attempts" >= 5);--> statement-breakpoint
CREATE UNIQUE INDEX "alert_deliveries_org_key_uq" ON "alert_deliveries" USING btree ("organization_id","dedup_key");--> statement-breakpoint
CREATE INDEX "alert_delivery_events_event_idx" ON "alert_delivery_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "alert_evaluations_scheduled_idx" ON "alert_evaluations" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "alert_events_org_occurred_idx" ON "alert_events" USING btree ("organization_id",occurred_at DESC);--> statement-breakpoint
CREATE INDEX "alert_events_org_fingerprint_idx" ON "alert_events" USING btree ("organization_id","instance_fingerprint",occurred_at DESC);--> statement-breakpoint
CREATE INDEX "alert_events_org_slug_idx" ON "alert_events" USING btree ("organization_id","slug",occurred_at DESC);--> statement-breakpoint
CREATE INDEX "alert_events_processed_idx" ON "alert_events" USING btree ("processed_at","id") WHERE "alert_events"."processed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_events_held_silence_idx" ON "alert_events" USING btree ("silence_id") WHERE "alert_events"."processed_at" IS NULL AND "alert_events"."silence_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_events_cancelable_idx" ON "alert_events" USING btree ("organization_id","source_definition_id") WHERE "alert_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "alert_events_org_definition_kind_idx" ON "alert_events" USING btree ("organization_id","source_definition_id","kind",occurred_at DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_org_id_uq" ON "alert_events" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_instances_definition_fingerprint_uq" ON "alert_instances" USING btree ("alert_definition_id","fingerprint");--> statement-breakpoint
CREATE INDEX "alert_instances_inactive_updated_idx" ON "alert_instances" USING btree ("updated_at","id") WHERE "alert_instances"."status" = 'inactive';--> statement-breakpoint
CREATE INDEX "alert_notification_group_events_event_idx" ON "alert_notification_group_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_notification_groups_org_key_uq" ON "alert_notification_groups" USING btree ("organization_id","group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_notification_groups_org_id_uq" ON "alert_notification_groups" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "alert_notification_groups_cleanup_idx" ON "alert_notification_groups" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "alert_notification_groups_direct_definition_idx" ON "alert_notification_groups" USING btree ("organization_id","direct_alert_definition_id");--> statement-breakpoint
CREATE INDEX "alert_silences_active_lookup_idx" ON "alert_silences" USING btree ("organization_id","ends_at");--> statement-breakpoint
CREATE INDEX "alert_silences_cleanup_idx" ON "alert_silences" USING btree ("ends_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_live_project_slug_uq" ON "dashboards" USING btree ("organization_id","project","slug") WHERE "dashboards"."preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_preview_project_slug_uq" ON "dashboards" USING btree ("preview_id","project","slug") WHERE "dashboards"."preview_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dashboards_tenant_updated_idx" ON "dashboards" USING btree ("organization_id",updated_at DESC);--> statement-breakpoint
CREATE INDEX "github_installation_orgs_org_id_idx" ON "github_installation_organizations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "previews_id_tenant_repo_uq" ON "previews" USING btree ("id","organization_id","repoid");--> statement-breakpoint
CREATE UNIQUE INDEX "previews_tenant_repo_name_uq" ON "previews" USING btree ("organization_id","repoid","name");--> statement-breakpoint
CREATE UNIQUE INDEX "runbooks_live_project_slug_uq" ON "runbooks" USING btree ("organization_id","project","slug") WHERE "runbooks"."preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "runbooks_preview_project_slug_uq" ON "runbooks" USING btree ("preview_id","project","slug") WHERE "runbooks"."preview_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runbooks_tenant_updated_idx" ON "runbooks" USING btree ("organization_id",updated_at DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_jobs_tenant_job_uq" ON "workflow_jobs" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_tenant_trace_id_idx" ON "workflow_jobs" USING btree ("organization_id","trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_tenant_run_attempts_uq" ON "workflow_runs" USING btree ("organization_id","run_id","attempts");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_tenant_trace_id_uq" ON "workflow_runs" USING btree ("organization_id","trace_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_tenant_repo_sha_ref_idx" ON "workflow_runs" USING btree ("organization_id","repository","sha","ref");--> statement-breakpoint
CREATE INDEX "workflow_runs_tenant_last_event_idx" ON "workflow_runs" USING btree ("organization_id",last_event_at DESC);--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauthClient_userId_idx" ON "oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthConsent_clientId_idx" ON "oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthConsent_userId_idx" ON "oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "alert_default_channels" ADD CONSTRAINT "alert_default_channels_organization_id_channel_id_alert_channels_organization_id_id_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."alert_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "alert_notification_groups" ADD CONSTRAINT "alert_notification_groups_direct_definition_tenant_fk" FOREIGN KEY ("organization_id","direct_alert_definition_id") REFERENCES "public"."alert_definitions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
