ALTER TABLE "organization" ADD COLUMN "owner_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "plan" text DEFAULT 'hobby' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_hobby_owner_uidx" ON "organization" USING btree ("owner_id") WHERE "organization"."plan" = 'hobby';