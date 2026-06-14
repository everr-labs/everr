CREATE TABLE "notebooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project" text NOT NULL,
	"slug" text NOT NULL,
	"folder_path" text DEFAULT '' NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notebooks_tenant_project_slug_uq" ON "notebooks" USING btree ("organization_id","project","slug");--> statement-breakpoint
CREATE INDEX "notebooks_tenant_updated_idx" ON "notebooks" USING btree ("organization_id",updated_at DESC);