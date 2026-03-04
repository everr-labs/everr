CREATE TYPE "public"."cli_device_authorization_status" AS ENUM('pending', 'approved', 'denied', 'consumed', 'expired');--> statement-breakpoint
CREATE TABLE "cli_device_authorizations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cli_device_authorizations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"status" "cli_device_authorization_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"poll_interval_seconds" integer DEFAULT 5 NOT NULL,
	"last_polled_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_for_organization_id" text,
	"approved_for_tenant_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cli_device_authorizations_device_code_hash_uq" ON "cli_device_authorizations" USING btree ("device_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_device_authorizations_user_code_uq" ON "cli_device_authorizations" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "cli_device_authorizations_status_expires_idx" ON "cli_device_authorizations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "access_tokens_revoked_expires_idx" ON "access_tokens" USING btree ("revoked_at","expires_at");