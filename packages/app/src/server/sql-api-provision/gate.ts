import type { SqlApiOrgUserSetup } from "./status";

// Checkout completion still has to run while provisioning is outstanding, and
// account settings are not organization data. Everywhere else, the app would
// look like a finished, empty registration.
const HOLD_EXEMPT_PATHS = new Set(["/account", "/checkout/success"]);

export function sqlApiSetupPathIsHeld(pathname: string): boolean {
  return !HOLD_EXEMPT_PATHS.has(pathname);
}

export function shouldHoldForSqlApiSetup(
  status: SqlApiOrgUserSetup,
  pathname: string,
): boolean {
  if (status === "ready") return false;
  return sqlApiSetupPathIsHeld(pathname);
}
