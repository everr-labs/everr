DO $$
BEGIN
  CREATE TYPE "public"."installation_status" AS ENUM('active', 'suspended', 'uninstalled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE "github_installation_tenants" (
	"github_installation_id" bigint PRIMARY KEY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"status" "installation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_installation_tenants" ADD CONSTRAINT "github_installation_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_installation_tenants_tenant_id_idx" ON "github_installation_tenants" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_external_id_uq" ON "tenants" USING btree ("external_id");
