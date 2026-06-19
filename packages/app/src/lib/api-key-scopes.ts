/**
 * Per-key capability scopes for the single `ek_` API key type.
 *
 * Keys carry a `permissions` map (better-auth `Statements` shape:
 * `Record<scope, action[]>`). The values are checked by the endpoints that
 * authenticate with a key, so a key can be minted with only one capability
 * (e.g. a CI deploy token with just `apply`) even though it shares the
 * `ek_` configId with telemetry keys.
 *
 * A key whose `permissions` is `null` or `undefined` is treated as having
 * every scope with the wildcard action — that matches the behavior before
 * scopes existed, so keys minted before this change keep working.
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

export type ApiKeyPermissions =
  | {
      [scope: string]: readonly string[];
    }
  | null
  | undefined;

const WILDCARD = "*";

/**
 * Returns true when the key is allowed to perform `action` under `scope`.
 *
 * `null`/`undefined` permissions mean "no scope declared" — for backward
 * compatibility, we treat that as fully scoped. An empty action array for a
 * scope is an explicit deny.
 */
export function hasApiKeyScope(
  permissions: ApiKeyPermissions,
  scope: ApiKeyScope,
  action: string = WILDCARD,
): boolean {
  if (permissions == null) return true;
  const actions = permissions[scope];
  if (!actions) return false;
  if (actions.length === 0) return false;
  if (actions.includes(WILDCARD)) return true;
  return actions.includes(action);
}

/**
 * Render a `permissions` map as a stable, human-readable list, sorted by
 * scope name, suitable for display in tables.
 */
export function describeApiKeyScopes(permissions: ApiKeyPermissions): string[] {
  if (permissions == null) {
    return Object.keys(API_KEY_SCOPES);
  }
  return Object.keys(API_KEY_SCOPES)
    .filter((scope) => {
      const actions = permissions[scope];
      return actions && actions.length > 0;
    })
    .sort();
}
