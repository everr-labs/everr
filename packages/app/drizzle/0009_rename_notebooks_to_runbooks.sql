ALTER TABLE "notebooks" RENAME TO "runbooks";--> statement-breakpoint
ALTER TABLE "alert_definitions" RENAME COLUMN "notebook_project" TO "runbook_project";--> statement-breakpoint
ALTER TABLE "alert_definitions" RENAME COLUMN "notebook_slug" TO "runbook_slug";--> statement-breakpoint
ALTER INDEX "notebooks_tenant_repo_project_slug_uq" RENAME TO "runbooks_tenant_repo_project_slug_uq";--> statement-breakpoint
ALTER INDEX "notebooks_tenant_updated_idx" RENAME TO "runbooks_tenant_updated_idx";