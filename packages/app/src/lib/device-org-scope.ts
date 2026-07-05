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

export function getActiveOrganizationIdFromAuthSession(session: unknown) {
  if (session && typeof session === "object" && "session" in session) {
    const inner = session.session;
    if (inner && typeof inner === "object" && "activeOrganizationId" in inner) {
      const activeOrganizationId = inner.activeOrganizationId;
      if (typeof activeOrganizationId === "string" && activeOrganizationId) {
        return activeOrganizationId;
      }
    }
  }
  return null;
}
