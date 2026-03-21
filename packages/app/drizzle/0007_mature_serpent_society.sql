CREATE TABLE "main_branches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "main_branches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"repository" text,
	"branches" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "main_branches" ADD CONSTRAINT "main_branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "main_branches_tenant_repo_uq" ON "main_branches" USING btree ("tenant_id","repository") WHERE repository IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "main_branches_tenant_org_uq" ON "main_branches" USING btree ("tenant_id") WHERE repository IS NULL;