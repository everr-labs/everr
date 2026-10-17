CREATE TABLE "previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repoid" text NOT NULL,
	"name" text NOT NULL,
	"last_applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "alert_definitions_org_repo_project_slug_uq";--> statement-breakpoint
DROP INDEX "dashboards_tenant_repo_project_slug_uq";--> statement-breakpoint
DROP INDEX "runbooks_tenant_repo_project_slug_uq";--> statement-breakpoint
ALTER TABLE "alert_definitions" ALTER COLUMN "repoid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboards" ALTER COLUMN "repoid" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "dashboards" ALTER COLUMN "repoid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runbooks" ALTER COLUMN "repoid" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "runbooks" ALTER COLUMN "repoid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD COLUMN "preview_id" uuid;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "preview_id" uuid;--> statement-breakpoint
ALTER TABLE "runbooks" ADD COLUMN "preview_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "previews_tenant_repo_name_uq" ON "previews" USING btree ("organization_id","repoid","name");--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD CONSTRAINT "alert_definitions_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_live_project_slug_uq" ON "alert_definitions" USING btree ("organization_id","project","slug") WHERE "alert_definitions"."preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_definitions_preview_project_slug_uq" ON "alert_definitions" USING btree ("preview_id","project","slug") WHERE "alert_definitions"."preview_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_live_project_slug_uq" ON "dashboards" USING btree ("organization_id","project","slug") WHERE "dashboards"."preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_preview_project_slug_uq" ON "dashboards" USING btree ("preview_id","project","slug") WHERE "dashboards"."preview_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "runbooks_live_project_slug_uq" ON "runbooks" USING btree ("organization_id","project","slug") WHERE "runbooks"."preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "runbooks_preview_project_slug_uq" ON "runbooks" USING btree ("preview_id","project","slug") WHERE "runbooks"."preview_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_definitions" ADD CONSTRAINT "alert_definitions_live_xor_preview" CHECK (("alert_definitions"."preview_id" IS NULL) <> ("alert_definitions"."repoid" IS NULL));--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_live_xor_preview" CHECK (("dashboards"."preview_id" IS NULL) <> ("dashboards"."repoid" IS NULL));--> statement-breakpoint
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_live_xor_preview" CHECK (("runbooks"."preview_id" IS NULL) <> ("runbooks"."repoid" IS NULL));