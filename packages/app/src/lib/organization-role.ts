const ROLE_SEPARATOR = ",";

export function hasOrganizationRole(
  role: string | null | undefined,
  expectedRoles: readonly string[],
) {
  if (!role) return false;

  const roles = role
    .split(ROLE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);

  return expectedRoles.some((expectedRole) => roles.includes(expectedRole));
}

export function isOrganizationAdmin(role: string | null | undefined) {
  return hasOrganizationRole(role, ["owner", "admin"]);
}

export function isOrganizationOwner(role: string | null | undefined) {
  return hasOrganizationRole(role, ["owner"]);
}

export class NotOrganizationAdminError extends Error {
  name = "NotOrganizationAdminError";

  constructor() {
    super("Not authorized");
  }
}

// Route guard for the admin pages. The admin server functions check the role
// themselves; this only picks the page.
export function requireOrganizationAdmin({
  context: { memberRole },
}: {
  context: { memberRole: string };
}) {
  if (!isOrganizationAdmin(memberRole)) throw new NotOrganizationAdminError();
}
