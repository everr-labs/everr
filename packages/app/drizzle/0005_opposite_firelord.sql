CREATE TYPE "public"."workflow_status" AS ENUM('requested', 'waiting', 'queued', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "workflow_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
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
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
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
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "repository_id" bigint;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_jobs_tenant_job_uq" ON "workflow_jobs" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_tenant_trace_id_idx" ON "workflow_jobs" USING btree ("tenant_id","trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_tenant_run_attempts_uq" ON "workflow_runs" USING btree ("tenant_id","run_id","attempts");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_tenant_trace_id_uq" ON "workflow_runs" USING btree ("tenant_id","trace_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_tenant_repo_ref_sha_idx" ON "workflow_runs" USING btree ("tenant_id","repository","ref","sha");