-- Better Auth 1.7 requires an explicit client-resource link. Under 1.6 the
-- MCP audience was allowed globally, so preserve access for registered clients.
-- The migration runner sets this installation's MCP URI on its locked session.
DO $$
BEGIN
	IF nullif(current_setting('everr.mcp_resource', true), '') IS NULL THEN
		RAISE EXCEPTION 'MCP resource URI is required for the OAuth backfill';
	END IF;
END $$;--> statement-breakpoint
INSERT INTO "oauth_resource" ("id", "identifier", "name", "created_at", "updated_at")
VALUES (
	gen_random_uuid()::text,
	current_setting('everr.mcp_resource'),
	current_setting('everr.mcp_resource'),
	now(),
	now()
)
ON CONFLICT ("identifier") DO NOTHING;--> statement-breakpoint
INSERT INTO "oauth_client_resource" ("id", "client_id", "resource_id", "created_at")
SELECT gen_random_uuid()::text, "client_id", current_setting('everr.mcp_resource'), now()
FROM "oauth_client"
ON CONFLICT ("client_id", "resource_id") DO NOTHING;--> statement-breakpoint
-- Only old, usable MCP refresh grants need an audience on their next refresh.
-- Other grants and already populated resource lists retain their original scope.
UPDATE "oauth_refresh_token"
SET "resources" = ARRAY[current_setting('everr.mcp_resource')]
WHERE "resources" IS NULL
	AND "scopes" @> ARRAY['observability:read']::text[]
	AND "revoked" IS NULL
	AND ("expires_at" IS NULL OR "expires_at" > now());
