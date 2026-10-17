CREATE TABLE "org_subscription" (
	"org_id" text PRIMARY KEY NOT NULL,
	"polar_subscription_id" text NOT NULL,
	"polar_product_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"polar_modified_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_billing" (
	"org_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'hobby' NOT NULL,
	"polar_customer_id" text,
	CONSTRAINT "organization_billing_polar_customer_id_unique" UNIQUE("polar_customer_id")
);
--> statement-breakpoint
CREATE TABLE "pro_organization_checkout" (
	"org_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"organization_name" text NOT NULL,
	"organization_slug" text NOT NULL,
	"checkout_id" text,
	"polar_customer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "pro_organization_checkout_organization_slug_unique" UNIQUE("organization_slug")
);
--> statement-breakpoint
ALTER TABLE "org_subscription" ADD CONSTRAINT "org_subscription_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pro_organization_checkout_pending_owner_name_uidx" ON "pro_organization_checkout" USING btree ("owner_id","organization_name") WHERE "pro_organization_checkout"."completed_at" is null;