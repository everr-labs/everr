class OrganizationTargetMismatchError extends Error {
  constructor() {
    super(
      "The authenticated organization differs from the selected target. Run everr login for the intended organization.",
    );
  }
}

export function organizationTargetErrorResponse(
  error: unknown,
): Response | null {
  return error instanceof OrganizationTargetMismatchError
    ? Response.json({ error: error.message }, { status: 409 })
    : null;
}

// This header asserts the caller's expected target. Authentication and membership
// still determine the organization; the header never grants access or switches it.
export function assertOrganizationTarget(
  headers: Headers,
  organizationId: string,
): void {
  const expected = headers.get("x-everr-organization-id");
  if (expected !== null && expected !== organizationId) {
    throw new OrganizationTargetMismatchError();
  }
}
