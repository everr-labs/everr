const DEVICE_ORG_SCOPE_PREFIX = "everr:org:";

export function withDeviceOrgScope(
  scope: string | null | undefined,
  organizationId: string,
) {
  const orgScope = `${DEVICE_ORG_SCOPE_PREFIX}${encodeURIComponent(organizationId)}`;
  const existingScopes = (scope ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !part.startsWith(DEVICE_ORG_SCOPE_PREFIX));

  return [...existingScopes, orgScope].join(" ");
}

export function getDeviceOrgIdFromScope(scope: string | null | undefined) {
  const orgScope = (scope ?? "")
    .split(/\s+/)
    .find((part) => part.startsWith(DEVICE_ORG_SCOPE_PREFIX));

  if (!orgScope) {
    return null;
  }

  const encoded = orgScope.slice(DEVICE_ORG_SCOPE_PREFIX.length);
  if (!encoded) {
    return null;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

// Context key for the device-login org, stashed by the /device/token
// before-hook (see the cli-device-organization plugin in auth.server.ts).
const DEVICE_ORG_CONTEXT_KEY = "everrDeviceOrgId";

export function markDeviceOrgContext(organizationId: string) {
  return { [DEVICE_ORG_CONTEXT_KEY]: organizationId };
}

export function getMarkedDeviceOrgIdFromContext(context: unknown) {
  const value = (context as Record<string, unknown> | null | undefined)?.[
    DEVICE_ORG_CONTEXT_KEY
  ];

  return typeof value === "string" && value ? value : null;
}

export function getActiveOrganizationIdFromAuthSession(session: unknown) {
  const activeOrganizationId = (
    session as {
      session?: {
        activeOrganizationId?: unknown;
      };
    } | null
  )?.session?.activeOrganizationId;

  return typeof activeOrganizationId === "string" && activeOrganizationId
    ? activeOrganizationId
    : null;
}
