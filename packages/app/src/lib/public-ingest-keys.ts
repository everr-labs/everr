/**
 * Public ingest keys: `ek_` API keys marked `{ public: true }` in their
 * better-auth metadata. A public key ships in browser page source, so it is
 * origin-bound (allowlist) and browser-only: it never authenticates
 * server-to-server ingestion, and a secret key never authenticates a
 * browser (Origin-bearing) request. This module is the single home of that
 * policy; verification, key settings, and the UI all delegate here.
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
 * better-auth config for hashed `ek_` keys: every secret key, plus public keys
 * created before public keys got their own config. The value stays "ingest"
 * for keys minted before the rename.
 */
export const HASHED_KEY_CONFIG_ID = "ingest";

/**
 * better-auth config for public keys. Stored unhashed so admins can copy a
 * public key again after creation; it ships in page source anyway. A key in
 * this config is always browser-only, whatever its metadata says.
 */
export const PUBLIC_KEY_CONFIG_ID = "public";

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function parseWebOrigin(raw: string): URL | null {
  const origin = raw.trim();
  // Check the original syntax before URL can repair an invalid authority
  // or collapse a path such as /a/.. into a bare slash.
  const authority = /^https?:\/\/([^/?#\\\s@]+)\/?$/i.exec(origin)?.[1];
  if (!authority || authority.endsWith(":") || authority.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  // URL decodes percent escapes in hostnames, including an escaped asterisk.
  return url.hostname.includes("*") ? null : url;
}

/** Canonicalize a concrete HTTP(S) origin as browsers serialize it. */
export function normalizeOrigin(raw: string): string | null {
  return parseWebOrigin(raw)?.origin ?? null;
}

function isWildcardSuffix(hostname: string): boolean {
  const labels = hostname.split(".");
  // A DNS suffix must leave room for the label matched by the wildcard.
  return (
    hostname.length <= 251 &&
    labels.length >= 2 &&
    labels.every((label) => DNS_LABEL.test(label)) &&
    !/^\d+$/.test(labels[labels.length - 1])
  );
}

/** An allowlist entry can be an exact origin or start with a single DNS wildcard. */
export function normalizeAllowedOrigin(raw: string): string | null {
  const entry = raw.trim();
  const withScheme = entry.startsWith("*.") ? `https://${entry}` : entry;
  const wildcard = /^(https?:\/\/)\*\.(.+)$/i.exec(withScheme);
  if (!wildcard) return normalizeOrigin(withScheme);

  const suffix = parseWebOrigin(`${wildcard[1]}${wildcard[2]}`);
  if (!suffix || !isWildcardSuffix(suffix.hostname)) return null;
  return `${suffix.protocol}//*.${suffix.host}`;
}

/**
 * Read a key's public-browser metadata. Returns null for secret keys.
 * better-auth stores metadata in a JSON text column and, depending on the
 * code path, hands back a parsed object or the raw string; accept both.
 */
export function publicKeyMetadataOf(metadata: unknown): PublicKeyMetadata | null {
  let value = metadata;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Preserve the existing stored metadata reader without adding schema validation.
  const record = value as Record<string, unknown>;
  if (record.public !== true) return null;
  const allowedOrigins = Array.isArray(record.allowedOrigins)
    ? record.allowedOrigins.filter((origin): origin is string => typeof origin === "string")
    : [];
  return { public: true, allowedOrigins };
}

/**
 * Build the metadata blob stored on a public browser key. Each origin is
 * normalized (and dropped if it somehow fails to parse) so the stored shape
 * stays canonical even when the caller skipped pre-validation. The write-side
 * counterpart of `publicKeyMetadataOf`.
 */
export function buildPublicKeyMetadata(origins: readonly string[]): PublicKeyMetadata {
  return {
    public: true,
    allowedOrigins: [
      ...new Set(
        origins.map(normalizeAllowedOrigin).filter((origin): origin is string => origin !== null),
      ),
    ],
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
 *
 * A key in the unhashed public config without public metadata is denied
 * outright: its plaintext is readable, so it must never act as a secret key.
 */
export function originPolicyAllows(
  key: { configId?: string | null; metadata: unknown },
  origin: string | null,
): boolean {
  const publicMeta = publicKeyMetadataOf(key.metadata);
  if (key.configId === PUBLIC_KEY_CONFIG_ID && !publicMeta) return false;
  if (origin === null) return publicMeta === null;
  if (!publicMeta) return false;
  const url = parseWebOrigin(origin);
  if (!url) return false;
  if (publicMeta.allowedOrigins.includes(url.origin)) return true;

  const firstDot = url.hostname.indexOf(".");
  if (
    firstDot === -1 ||
    url.hostname.length > 253 ||
    !DNS_LABEL.test(url.hostname.slice(0, firstDot)) ||
    !isWildcardSuffix(url.hostname.slice(firstDot + 1))
  ) {
    return false;
  }
  // Replace only the first label, keeping the scheme and port in the match.
  return publicMeta.allowedOrigins.includes(`${url.protocol}//*${url.host.slice(firstDot)}`);
}

export function allowedOriginsInputError(origins: readonly string[]): string | null {
  if (origins.length === 0) return "Public keys need at least one allowed origin";
  if (origins.length > 32) return "At most 32 origins per key";
  for (const origin of origins) {
    if (!normalizeAllowedOrigin(origin)) return `Not a valid origin: ${origin}`;
  }
  return null;
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
  if (!input.public) {
    return input.allowedOrigins?.length ? "Allowed origins require a public key" : null;
  }

  const originError = allowedOriginsInputError(input.allowedOrigins ?? []);
  if (originError) return originError;
  if (input.scopes.length !== 1 || input.scopes[0] !== PUBLIC_KEY_SCOPE) {
    return "Public keys can only send telemetry";
  }

  return null;
}
