import { z } from "zod";
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "@/lib/local-storage";

/**
 * The dashboard to reopen when `/dashboards` is visited without a choice.
 * Local to the browser on purpose: "where was I" is a property of this
 * machine's session, not of the Organization, so it needs no server state.
 */
const LastViewedSchema = z.union([
  z.object({ kind: z.literal("built-in"), slug: z.string() }),
  z.object({ kind: z.literal("own"), project: z.string(), slug: z.string() }),
]);

export type LastViewedDashboard = z.infer<typeof LastViewedSchema>;

// Keyed per organization: a remembered dashboard from one org must not open
// (or shadow) a same-named dashboard after switching orgs in the same browser.
const keyFor = (org: string) => `everr:last-dashboard:${org}`;

export function readLastViewed(org: string): LastViewedDashboard | null {
  return readLocalStorage(keyFor(org), LastViewedSchema);
}

export function recordLastViewed(
  org: string,
  value: LastViewedDashboard,
): void {
  writeLocalStorage(keyFor(org), value);
}

export function clearLastViewed(org: string): void {
  removeLocalStorage(keyFor(org));
}
