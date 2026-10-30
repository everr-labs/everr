-- Better Auth 1.6.33 -> 1.7.12.
--
-- Three parts, in the order the 1.7 upgrade guide requires:
--   1. account identity, which needs a credential backfill
--   2. device code uniqueness, which needs duplicates gone first
--   3. the OAuth provider tables, including the new resource models
--
-- https://better-auth.com/docs/guides/1-7-upgrade-guide

-- 1. Account identity ------------------------------------------------------
--
-- 1.7.12 identifies an account by (provider_id, account_id). Credential
-- accounts now use the stable user id for account_id rather than the mutable
-- email address. OAuth account ids already hold the provider's stable id.
UPDATE "account"
SET "account_id" = "user_id"
WHERE "provider_id" = 'credential';--> statement-breakpoint
DO $$
DECLARE collisions bigint;
BEGIN
	SELECT count(*) INTO collisions
	FROM (
		SELECT 1
		FROM "account"
		GROUP BY "provider_id", "account_id"
		HAVING count(*) > 1
	) duplicates;

	IF collisions > 0 THEN
		RAISE EXCEPTION 'better-auth 1.7: % (provider_id, account_id) collision(s) in "account". Establish each key''s owner from trusted provider data and reconcile by hand; never merge users on matching email.', collisions;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "account_providerId_accountId_uidx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint

-- 2. Device codes ----------------------------------------------------------
--
-- 1.7 reads a device code through `consumeOne`, which needs a unique lookup.
-- Duplicates in either column would fail the index, so the older row goes.
-- A device code lives for minutes and a discarded one costs its owner one
-- retry of `cloud login`, so this is safe to do in place.
DELETE FROM "device_code" older
USING "device_code" newer
WHERE older."device_code" = newer."device_code"
  AND (older."expires_at", older."id") < (newer."expires_at", newer."id");--> statement-breakpoint
DELETE FROM "device_code" older
USING "device_code" newer
WHERE older."user_code" = newer."user_code"
  AND (older."expires_at", older."id") < (newer."expires_at", newer."id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_deviceCode_uidx" ON "device_code" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_userCode_uidx" ON "device_code" USING btree ("user_code");--> statement-breakpoint

-- 3. OAuth provider --------------------------------------------------------
--
-- Better Auth 1.7 supports configured resources and resource rows with their
-- own token policies. Everr configures its MCP resource installation-wide.
CREATE TABLE "oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
-- Replay guard for private_key_jwt and client_secret_jwt client assertions:
-- the row id is the assertion jti, so a re-presented assertion collides.
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" ON "oauth_client_resource" USING btree ("client_id","resource_id");--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "client_discovery_id" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "client_credentials_scopes" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "backchannel_logout_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "backchannel_logout_session_required" boolean;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "application_type" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "jwks" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "jwks_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "dpop_bound_access_tokens" boolean DEFAULT false;--> statement-breakpoint
-- `type` and `public` are gone in 1.7. A client's shape is now carried by
-- `application_type`, and confidential-versus-public is decided by the
-- token-endpoint auth method alone: `none` is public, anything else is not.
-- The guide asks for `user-agent-based` clients to be judged one at a time,
-- so stop rather than fold them into `web`.
DO $$
DECLARE agent_based bigint;
BEGIN
	SELECT count(*) INTO agent_based
	FROM "oauth_client"
	WHERE "type" = 'user-agent-based';

	IF agent_based > 0 THEN
		RAISE EXCEPTION 'better-auth 1.7: % oauth_client row(s) of type user-agent-based. Assign each one an application_type by hand before migrating.', agent_based;
	END IF;
END $$;--> statement-breakpoint
UPDATE "oauth_client"
SET "application_type" = CASE WHEN "type" = 'native' THEN 'native' ELSE 'web' END
WHERE "application_type" IS NULL;--> statement-breakpoint
UPDATE "oauth_client"
SET "token_endpoint_auth_method" = CASE WHEN "public" THEN 'none' ELSE 'client_secret_basic' END
WHERE "token_endpoint_auth_method" IS NULL;--> statement-breakpoint
ALTER TABLE "oauth_client" DROP COLUMN "public";--> statement-breakpoint
ALTER TABLE "oauth_client" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "authorization_code_id" text;--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauth_refresh_token" USING btree ("authorization_code_id");--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "requested_user_info_claims" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "rotated_at" timestamp;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "rotation_replay_response" text;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "rotation_replay_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "authorization_code_id" text;--> statement-breakpoint
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauth_access_token" USING btree ("authorization_code_id");--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "requested_user_info_claims" text[];--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "revoked" timestamp;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN "requested_user_info_claims" text[];--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN "alg" text;--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN "crv" text;
