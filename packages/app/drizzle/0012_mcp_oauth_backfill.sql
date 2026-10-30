-- Restore the MCP audience on usable refresh grants created before 1.7.
-- The migration runner sets this installation's MCP URI on its locked session.
DO $$
BEGIN
	IF nullif(current_setting('everr.mcp_resource', true), '') IS NULL THEN
		RAISE EXCEPTION 'MCP resource URI is required for the OAuth backfill';
	END IF;
END $$;--> statement-breakpoint
-- Only old, usable MCP refresh grants need an audience on their next refresh.
-- Other grants and already populated resource lists retain their original scope.
UPDATE "oauth_refresh_token"
SET "resources" = ARRAY[current_setting('everr.mcp_resource')]
WHERE "resources" IS NULL
	AND "scopes" @> ARRAY['observability:read']::text[]
	AND "revoked" IS NULL
	AND ("expires_at" IS NULL OR "expires_at" > now());
