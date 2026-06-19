/**
 * Per-key capability scopes for the single `ek_` API key type.
 *
 * Keys carry a `permissions` map (better-auth `Statements` shape:
 * `Record<scope, action[]>`). The values are checked by the endpoints that
 * authenticate with a key, so a key can be minted with only one capability
 * (e.g. a CI deploy token with just `apply`) even though it shares the
 * `ek_` configId with telemetry keys.
 *
 * A key with no capabilities (a `null`/`undefined`/empty `permissions` map)
 * is rejected: it grants nothing. Keys minted before scopes existed are
 * backfilled with the full capability set by a one-time migration
 * (`drizzle/0006_backfill_api_key_capabilities.sql`), so they keep working
 * without relying on an implicit "null means everything" fallback.
 */
export const API_KEY_SCOPES = {
  ingest: {
    label: "Send telemetry",
    description: "Send OpenTelemetry logs, traces, and metrics to Everr.",
    actions: ["write"] as const,
  },
  apply: {
    label: "Manage as code",
    description:
      "Create and update dashboards, notebooks, and alerts with everr apply.",
    actions: ["read", "write", "delete"] as const,
  },
} as const;

export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

/**
 * Every scope as a non-empty tuple. This is the one list both the client
 * (scope pickers) and the server (zod validation, `z.enum`) derive from, so
 * adding a capability is a single edit to `API_KEY_SCOPES`.
 */
export const ALL_API_KEY_SCOPES = Object.keys(API_KEY_SCOPES) as [
  ApiKeyScope,
  ...ApiKeyScope[],
];

export type ApiKeyPermissions =
  | Partial<Record<ApiKeyScope, readonly string[]>>
  | null
  | undefined;

const WILDCARD = "*";

/**
 * Returns true when the key is allowed to act under `scope`.
 *
 * With no `action`, the check is "does the key hold this scope at all" — true
 * when the scope has at least one action. With an `action`, the key passes if
 * it holds the wildcard or that specific action.
 *
 * A key with no capabilities — `null`/`undefined` permissions, a scope absent
 * from the map, or an empty action array — grants nothing and is rejected.
 */
export function hasApiKeyScope(
  permissions: ApiKeyPermissions,
  scope: ApiKeyScope,
  action?: string,
): boolean {
  if (permissions == null) return false;
  const actions = permissions[scope];
  if (!actions || actions.length === 0) return false;
  // No specific action requested: holding the scope is enough.
  if (action === undefined) return true;
  // The wildcard grants every action under the scope.
  if (actions.includes(WILDCARD)) return true;
  return actions.includes(action);
}

/**
 * Render a `permissions` map as a human-readable list of the scopes the key
 * holds, in `API_KEY_SCOPES` declaration order — the same order the create
 * dialog lists them, so table badges and the picker stay consistent. A key
 * with no capabilities yields an empty list.
 */
export function describeApiKeyScopes(
  permissions: ApiKeyPermissions,
): ApiKeyScope[] {
  if (permissions == null) {
    return [];
  }
  return ALL_API_KEY_SCOPES.filter((scope) => {
    const actions = permissions[scope];
    return actions != null && actions.length > 0;
  });
}
