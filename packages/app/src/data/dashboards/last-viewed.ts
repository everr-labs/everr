/**
 * The dashboard to reopen when `/dashboards` is visited without a choice.
 * Local to the browser on purpose: "where was I" is a property of this
 * machine's session, not of the Organization, so it needs no server state.
 * `project` absent means a Built-in dashboard.
 */
export interface LastViewedDashboard {
  project?: string;
  slug: string;
}

const KEY = "everr:last-dashboard";

export function readLastViewed(): LastViewedDashboard | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as LastViewedDashboard).slug === "string"
    ) {
      return parsed as LastViewedDashboard;
    }
  } catch {
    // Corrupt or inaccessible storage reads as "no history".
  }
  return null;
}

export function recordLastViewed(value: LastViewedDashboard): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Quota or privacy-mode failures just lose the nicety.
  }
}
