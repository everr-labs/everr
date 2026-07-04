/**
 * Public ingest keys: `ek_` API keys marked `{ public: true }` in their
 * better-auth metadata. A public key ships in browser page source, so it is
 * origin-bound (allowlist) and browser-only: it never authenticates
 * server-to-server ingestion, and a secret key never authenticates a
 * browser (Origin-bearing) request. This module is the single home of that
 * policy; verify-key, the create server fn, and the UI all delegate here.
 */

import type { ApiKeyScope } from "./api-key-scopes";

export type PublicKeyMetadata = {
  public: true;
  allowedOrigins: string[];
};

/**
 * The one capability a public browser key may hold. Public keys are
 * browser-ingestion-only, so both the creation invariant here and the UI's
 * capability lock reference this single constant. Typed as `ApiKeyScope` so a
 * rename of the scope is caught at compile time.
 */
export const PUBLIC_KEY_SCOPE: ApiKeyScope = "ingest";

/**
 * Parse `raw` as a web origin (`scheme://host[:port]`, http/https only) and
 * return its canonical form, or null when it isn't one. `URL#origin`
 * lowercases the host and drops default ports, which is exactly what
 * browsers send in the Origin header, so stored entries and incoming
 * headers normalize to the same string.
 */
export function normalizeOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // A bare origin (with or without a trailing slash in the input) parses to
  // pathname "/", so reject anything else: real paths, queries, fragments.
  if (url.pathname !== "/" || url.search || url.hash) {
    return null;
  }
  return url.origin;
}

/**
 * Read a key's public-browser metadata. Returns null for secret keys.
 * better-auth stores metadata in a JSON text column and, depending on the
 * code path, hands back a parsed object or the raw string; accept both.
 */
export function publicKeyMetadataOf(
  metadata: unknown,
): PublicKeyMetadata | null {
  let value = metadata;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.public !== true) return null;
  const allowedOrigins = Array.isArray(record.allowedOrigins)
    ? record.allowedOrigins.filter(
        (origin): origin is string => typeof origin === "string",
      )
    : [];
  return { public: true, allowedOrigins };
}

/**
 * Build the metadata blob stored on a public browser key. Each origin is
 * normalized (and dropped if it somehow fails to parse) so the stored shape
 * stays canonical even when the caller skipped pre-validation. The write-side
 * counterpart of `publicKeyMetadataOf`.
 */
export function buildPublicKeyMetadata(
  origins: readonly string[],
): PublicKeyMetadata {
  return {
    public: true,
    allowedOrigins: origins
      .map(normalizeOrigin)
      .filter((origin): origin is string => origin !== null),
  };
}

/**
 * The browser-ingestion policy matrix. `origin` is the request's Origin
 * header, null when absent (server-to-server traffic).
 *
 * - secret key, no origin: allow (unchanged server-to-server ingestion)
 * - public key, no origin: deny (public keys are browser-only)
 * - secret key, origin:    deny (secret keys never work from browsers)
 * - public key, origin:    allow iff the normalized origin is allowlisted
 */
export function originPolicyAllows(
  metadata: unknown,
  origin: string | null,
): boolean {
  const publicMeta = publicKeyMetadataOf(metadata);
  if (origin === null) return publicMeta === null;
  if (!publicMeta) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return publicMeta.allowedOrigins.includes(normalized);
}

/**
 * Creation invariants for the create-key input, shared by the server fn's
 * zod schema and usable for client-side pre-checks. Returns a user-facing
 * error message, or null when the input is valid.
 */
export function publicKeyInputError(input: {
  public?: boolean;
  allowedOrigins?: readonly string[];
  scopes: readonly string[];
}): string | null {
  if (input.public) {
    if (!input.allowedOrigins || input.allowedOrigins.length === 0) {
      return "Public keys need at least one allowed origin";
    }
    if (input.scopes.length !== 1 || input.scopes[0] !== PUBLIC_KEY_SCOPE) {
      return "Public keys can only send telemetry";
    }
  } else if (input.allowedOrigins && input.allowedOrigins.length > 0) {
    return "Allowed origins require a public key";
  }
  for (const origin of input.allowedOrigins ?? []) {
    if (!normalizeOrigin(origin)) {
      return `Not a valid origin: ${origin}`;
    }
  }
  return null;
}
