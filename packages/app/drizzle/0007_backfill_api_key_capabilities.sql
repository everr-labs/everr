-- Backfill capabilities for API keys minted before per-key scopes existed.
--
-- Such keys carry a NULL/empty `permissions` map and used to be treated as
-- "fully scoped" at verify time. We are removing that implicit fallback — the
-- server now rejects keys with no capabilities — so we must first grant every
-- legacy `ek_` key the full capability set it effectively already had:
--   ingest -> write
--   apply  -> read, write, delete
-- (mirrors the action sets in `API_KEY_SCOPES`, lib/api-key-scopes.ts).
--
-- Scoped to the `ingest` config (the `ek_` key type). Only rows with no
-- meaningful permission map are touched, so re-running is a no-op and keys
-- minted with explicit scopes are left untouched.
UPDATE "apikey"
SET "permissions" = '{"ingest":["write"],"apply":["read","write","delete"]}'
WHERE "config_id" = 'ingest'
  AND (
    "permissions" IS NULL
    OR btrim("permissions") IN ('', 'null', '{}')
  );
