import type { apiKey } from "@better-auth/api-key";
import { HASHED_KEY_CONFIG_ID, PUBLIC_KEY_CONFIG_ID } from "#app/lib/public-ingest-keys.ts";

const shared = {
  references: "organization",
  defaultPrefix: "ek_",
  requireName: true,
  // The collector hits the verify endpoint on every cache miss; better-auth's
  // default rate limit (10 / 24h) would quickly disable real keys. Rate
  // limiting against abuse lives in the collector cache and the
  // shared-secret-guarded verify endpoint, not here.
  rateLimit: { enabled: false },
  // Public browser keys store `{ public: true, allowedOrigins }` in the
  // metadata JSON column; the plugin rejects metadata on create unless this
  // is on.
  enableMetadata: true,
  // No default permissions on purpose: capability choice is explicit. A key
  // created without a `permissions` map grants nothing: the collector verify
  // and apply endpoints check the scope and reject a key with no
  // capabilities. The API keys UI always sends an explicit, least-privilege
  // scope set (at least one capability). Keys minted before scopes existed are
  // backfilled with the full set by the API-key capabilities backfill
  // migration.
} as const;

export const API_KEY_CONFIGS = [
  // Every secret key, and public keys created before the public config existed.
  { configId: HASHED_KEY_CONFIG_ID, ...shared },
  // Public keys ship in page source, so their plaintext is stored to let
  // admins copy one again. Same `ek_` prefix, so verify-key looks the key up
  // to pick the config.
  { configId: PUBLIC_KEY_CONFIG_ID, ...shared, disableKeyHashing: true },
] satisfies Parameters<typeof apiKey>[0];
