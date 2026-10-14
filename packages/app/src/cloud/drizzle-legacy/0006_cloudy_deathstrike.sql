DROP INDEX "alert_definitions_org_repo_slug_uq";--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD COLUMN "project" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD COLUMN "notebook_project" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD COLUMN "notebook_slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_org_repo_project_slug_uq" ON "alert_definitions" USING btree ("organization_id","repoid","project","slug");