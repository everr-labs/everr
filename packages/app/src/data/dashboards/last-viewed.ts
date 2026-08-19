/**
 * The dashboard to reopen when `/dashboards` is visited without a choice.
 * Local to the browser on purpose: "where was I" is a property of this
 * machine's session, not of the Organization, so it needs no server state.
 */
export type LastViewedDashboard =
  | { kind: "built-in"; slug: string }
  | { kind: "own"; project: string; slug: string };

// Keyed per organization: a remembered dashboard from one org must not open
// (or shadow) a same-named dashboard after switching orgs in the same browser.
const keyFor = (org: string) => `everr:last-dashboard:${org}`;

function isLastViewed(parsed: unknown): parsed is LastViewedDashboard {
  if (typeof parsed !== "object" || parsed === null) return false;
  const value = parsed as Record<string, unknown>;
  if (typeof value.slug !== "string") return false;
  return (
    value.kind === "built-in" ||
    (value.kind === "own" && typeof value.project === "string")
  );
}

export function readLastViewed(org: string): LastViewedDashboard | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(org));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isLastViewed(parsed)) return parsed;
  } catch {
    // Corrupt or inaccessible storage reads as "no history".
  }
  return null;
}

export function recordLastViewed(
  org: string,
  value: LastViewedDashboard,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(org), JSON.stringify(value));
  } catch {
    // Quota or privacy-mode failures just lose the nicety.
  }
}
