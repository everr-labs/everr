CREATE TABLE "previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text NOT NULL,
	"name" text NOT NULL,
	"last_applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- DROP INDEX "alert_definitions_org_repo_project_slug_uq";--> statement-breakpoint
-- DROP INDEX "dashboards_tenant_repo_project_slug_uq";--> statement-breakpoint
-- DROP INDEX "runbooks_tenant_repo_project_slug_uq";--> statement-breakpoint
-- ALTER TABLE "alert_definitions" ADD COLUMN "preview" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- ALTER TABLE "dashboards" ADD COLUMN "preview" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- ALTER TABLE "runbooks" ADD COLUMN "preview" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "previews_tenant_repo_name_uq" ON "previews" USING btree ("organization_id","repoid","name");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_org_repo_project_slug_uq" ON "alert_definitions" USING btree ("organization_id","repoid","preview","project","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_tenant_repo_project_slug_uq" ON "dashboards" USING btree ("organization_id","repoid","preview","project","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "runbooks_tenant_repo_project_slug_uq" ON "runbooks" USING btree ("organization_id","repoid","preview","project","slug");
