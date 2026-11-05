CREATE TABLE "user_terms" (
	"user_id" text PRIMARY KEY NOT NULL,
	"terms_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_terms" ADD CONSTRAINT "user_terms_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;