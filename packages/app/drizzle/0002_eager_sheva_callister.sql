CREATE TABLE "dashboard_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"folder_id" uuid,
	"slug" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_folders" ADD CONSTRAINT "dashboard_folders_parent_id_dashboard_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."dashboard_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_folder_id_dashboard_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."dashboard_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_folders_tenant_parent_name_uq" ON "dashboard_folders" USING btree ("organization_id",COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'),"name");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_tenant_slug_uq" ON "dashboards" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "dashboards_tenant_updated_idx" ON "dashboards" USING btree ("organization_id",updated_at DESC);