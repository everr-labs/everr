/**
 * Capabilities granted by a key's permissions map. Secret keys select scopes
 * at creation; public keys only ingest. An empty map grants nothing.
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
      "Create and update dashboards, runbooks, and alerts with everr apply.",
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
