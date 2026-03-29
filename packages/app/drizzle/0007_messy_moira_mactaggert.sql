DROP INDEX "workflow_runs_tenant_repo_ref_sha_idx";--> statement-breakpoint
CREATE INDEX "workflow_runs_tenant_repo_sha_ref_idx" ON "workflow_runs" USING btree ("tenant_id","repository","sha","ref");--> statement-breakpoint
CREATE INDEX "workflow_runs_tenant_last_event_idx" ON "workflow_runs" USING btree ("tenant_id",last_event_at DESC);