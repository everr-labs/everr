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
ALTER TABLE "organization" ADD COLUMN "polar_customer_id" text;--> statement-breakpoint
ALTER TABLE "pro_organization_checkout" ADD CONSTRAINT "pro_organization_checkout_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pro_organization_checkout_pending_owner_name_uidx" ON "pro_organization_checkout" USING btree ("owner_id","organization_name") WHERE "pro_organization_checkout"."completed_at" is null;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_polar_customer_id_unique" UNIQUE("polar_customer_id");