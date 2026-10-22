const DEVICE_ORG_SCOPE_PREFIX = "everr:org:";

export function withDeviceOrgScope(scope: string | null | undefined, organizationId: string) {
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

type AuthSessionOrganization = { session?: { activeOrganizationId?: unknown } } | null;

export function getActiveOrganizationIdFromAuthSession(session: unknown) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Preserve optional property access without adding input shape guards.
  const activeOrganizationId = (session as AuthSessionOrganization)?.session?.activeOrganizationId;

  return typeof activeOrganizationId === "string" && activeOrganizationId
    ? activeOrganizationId
    : null;
}
