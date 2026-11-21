export const EXPECTED_ORGANIZATION_HEADER = "x-everr-expected-organization";
export const ORGANIZATION_CHANGED = "Active organization changed";

// Every tab shares one session, active organization included, so it can change
// under a page that still shows the previous organization. Server functions
// compare the organization the page shows with the session's and refuse a
// mismatch, so this page never reads or changes the other organization's data.
let expectedOrganizationId: string | undefined;

/** Set by the route guards. A no-op on the server, where it would be shared by every request. */
export function expectOrganization(organizationId: string | undefined) {
  if (typeof window !== "undefined") expectedOrganizationId = organizationId;
}

export function expectedOrganizationHeaders(): Record<string, string> | undefined {
  return expectedOrganizationId
    ? { [EXPECTED_ORGANIZATION_HEADER]: expectedOrganizationId }
    : undefined;
}
