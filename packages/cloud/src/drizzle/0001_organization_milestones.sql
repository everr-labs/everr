CREATE TABLE "organization_milestones" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"rule_version" integer NOT NULL,
	"observer_started_at" timestamp with time zone NOT NULL,
	"first_queryable_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"surface" text NOT NULL,
	CONSTRAINT "organization_milestones_rule_check" CHECK ("organization_milestones"."rule_version" = 1),
	CONSTRAINT "organization_milestones_surface_check" CHECK ("organization_milestones"."surface" in ('ui', 'cli', 'mcp')),
	CONSTRAINT "organization_milestones_time_check" CHECK ("organization_milestones"."observer_started_at" <= "organization_milestones"."first_queryable_at" and "organization_milestones"."first_queryable_at" = "organization_milestones"."activated_at")
);
--> statement-breakpoint
ALTER TABLE "organization_milestones" ADD CONSTRAINT "organization_milestones_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;