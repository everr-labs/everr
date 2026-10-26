CREATE TABLE "crm_bootstrap" (
	"deployment" text NOT NULL,
	"account_scope" text NOT NULL,
	"scan_id" text NOT NULL,
	"phase" text NOT NULL,
	"cursor" text,
	"cursor_kind" text,
	"admitted" integer DEFAULT 0 NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_bootstrap_deployment_account_scope_pk" PRIMARY KEY("deployment","account_scope"),
	CONSTRAINT "crm_bootstrap_phase_check" CHECK ("crm_bootstrap"."phase" in ('user', 'organization', 'member', 'projection', 'completed')),
	CONSTRAINT "crm_bootstrap_progress_check" CHECK ("crm_bootstrap"."admitted" >= 0 and "crm_bootstrap"."pages" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crm_brevo_budget" (
	"account_scope" text NOT NULL,
	"endpoint_group" text NOT NULL,
	"next_allowed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "crm_brevo_budget_account_scope_endpoint_group_pk" PRIMARY KEY("account_scope","endpoint_group"),
	CONSTRAINT "crm_brevo_budget_group_check" CHECK ("crm_brevo_budget"."endpoint_group" in ('contacts', 'general'))
);
--> statement-breakpoint
CREATE TABLE "crm_projection" (
	"deployment" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text,
	"organization_id" text,
	"remote_id" text,
	"company_create_attempted_at" timestamp with time zone,
	"company_read" jsonb,
	"cleanup_company_read" jsonb,
	"remote_contact_id" text,
	"remote_company_id" text,
	"desired" jsonb NOT NULL,
	"desired_revision" integer DEFAULT 1 NOT NULL,
	"remote_check_id" text,
	"synced_revision" integer,
	"retry_failures" integer DEFAULT 0 NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"pending_since" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_projection_deployment_kind_source_id_pk" PRIMARY KEY("deployment","kind","source_id"),
	CONSTRAINT "crm_projection_kind_check" CHECK ("crm_projection"."kind" in ('user', 'organization', 'membership')),
	CONSTRAINT "crm_projection_endpoints_check" CHECK (
    ("crm_projection"."kind" = 'user' and "crm_projection"."user_id" = "crm_projection"."source_id" and "crm_projection"."user_id" is not null and "crm_projection"."organization_id" is null)
    or ("crm_projection"."kind" = 'organization' and "crm_projection"."organization_id" = "crm_projection"."source_id" and "crm_projection"."organization_id" is not null and "crm_projection"."user_id" is null)
    or ("crm_projection"."kind" = 'membership' and "crm_projection"."user_id" is not null and "crm_projection"."organization_id" is not null)
  ),
	CONSTRAINT "crm_projection_revision_check" CHECK ("crm_projection"."desired_revision" > 0 and ("crm_projection"."synced_revision" is null or "crm_projection"."synced_revision" <= "crm_projection"."desired_revision")),
	CONSTRAINT "crm_projection_retry_failures_check" CHECK ("crm_projection"."retry_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crm_reconciliation" (
	"deployment" text NOT NULL,
	"account_scope" text NOT NULL,
	"scan_id" text NOT NULL,
	"phase" text NOT NULL,
	"cursor" text,
	"cursor_kind" text,
	"admitted" integer DEFAULT 0 NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_reconciliation_deployment_account_scope_pk" PRIMARY KEY("deployment","account_scope")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_projection_external_id_uidx" ON "crm_projection" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_projection_remote_id_uidx" ON "crm_projection" USING btree ("deployment","kind","remote_id");