import { ORGANIZATION_CHANGED } from "#app/lib/expected-organization.ts";

// The messages `AuthError` (org-session.server.ts) and `NotOrganizationAdminError`
// carry. Server function errors reach the browser as plain `Error`s, so the
// message is what survives.
const AUTH_FAILURES = new Set([
  "Unauthenticated",
  "No active organization",
  "Not a member of the active organization",
  "Organization suspended",
  "Not authorized",
  ORGANIZATION_CHANGED,
]);

/**
 * The session ended, or the user's organization, role or subscription changed
 * since the page loaded. Retrying cannot fix any of them; reading access again can.
 */
export function isAuthFailure(error: unknown) {
  return error instanceof Error && AUTH_FAILURES.has(error.message);
}
