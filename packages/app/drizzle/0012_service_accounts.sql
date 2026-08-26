CREATE TABLE "service_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "service_account_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"service_account_id" text NOT NULL,
	"hash" text NOT NULL,
	"start" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_request" timestamp
);
--> statement-breakpoint
CREATE TABLE "service_account_token" (
	"id" text PRIMARY KEY NOT NULL,
	"service_account_secret_id" text NOT NULL,
	"hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_service_account" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_account" ADD CONSTRAINT "service_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account" ADD CONSTRAINT "service_account_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_secret" ADD CONSTRAINT "service_account_secret_service_account_id_service_account_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_token" ADD CONSTRAINT "service_account_token_service_account_secret_id_service_account_secret_id_fk" FOREIGN KEY ("service_account_secret_id") REFERENCES "public"."service_account_secret"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_account_userId_uidx" ON "service_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_account_secret_hash_uidx" ON "service_account_secret" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "service_account_secret_accountId_idx" ON "service_account_secret" USING btree ("service_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_account_token_hash_uidx" ON "service_account_token" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "service_account_token_secretId_idx" ON "service_account_token" USING btree ("service_account_secret_id");