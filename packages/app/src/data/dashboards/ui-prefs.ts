/**
 * Sticky UI flags for the dashboards rail. Local to the browser on purpose,
 * like last-viewed: how someone arranged their rail is a property of this
 * machine's session, not of the Organization.
 */
const BUILTINS_COLLAPSED_KEY = "everr:builtins-collapsed";

export function readBuiltinsCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BUILTINS_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBuiltinsCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (collapsed) {
      window.localStorage.setItem(BUILTINS_COLLAPSED_KEY, "1");
    } else {
      window.localStorage.removeItem(BUILTINS_COLLAPSED_KEY);
    }
  } catch {
    // Privacy-mode failures just lose the persistence.
  }
}
