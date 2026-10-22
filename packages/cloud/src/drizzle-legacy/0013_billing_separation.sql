CREATE TABLE "organization_billing" (
	"org_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'hobby' NOT NULL,
	"polar_customer_id" text,
	CONSTRAINT "organization_billing_polar_customer_id_unique" UNIQUE("polar_customer_id")
);
--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT "organization_polar_customer_id_unique";--> statement-breakpoint
ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "organization_billing" ("org_id", "plan", "polar_customer_id")
SELECT "id", "plan", "polar_customer_id" FROM "organization";
--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "polar_customer_id";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "plan";