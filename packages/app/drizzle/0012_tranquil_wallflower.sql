ALTER TABLE "organization" ADD COLUMN "owner_id" text;--> statement-breakpoint
UPDATE "organization" AS "organization_to_backfill"
SET "owner_id" = (
	SELECT "owner_membership"."user_id"
	FROM "member" AS "owner_membership"
	WHERE "owner_membership"."organization_id" = "organization_to_backfill"."id"
		AND 'owner' = ANY(string_to_array(replace("owner_membership"."role", ' ', ''), ','))
	ORDER BY "owner_membership"."created_at", "owner_membership"."id"
	LIMIT 1
);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "organization" WHERE "owner_id" IS NULL) THEN
		RAISE EXCEPTION 'Cannot backfill organization.owner_id: an organization has no Owner membership';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "plan" text DEFAULT 'hobby' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_hobby_owner_uidx" ON "organization" USING btree ("owner_id") WHERE "organization"."plan" = 'hobby';
