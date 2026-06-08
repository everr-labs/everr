CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"slug" text NOT NULL,
	"folder_path" text DEFAULT '' NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_tenant_source_slug_uq" ON "dashboards" USING btree ("organization_id","source","slug");--> statement-breakpoint
CREATE INDEX "dashboards_tenant_updated_idx" ON "dashboards" USING btree ("organization_id",updated_at DESC);