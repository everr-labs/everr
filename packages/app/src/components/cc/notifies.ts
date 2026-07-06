// packages/app/src/components/cc/notifies.ts
// Notifies: enabled default channels + the first matching custom rule per
// label set (or a caller-supplied fallback label set when nothing is
// firing). Managed catch-all routes (the org-default channels themselves)
// are excluded so they aren't double-counted as "custom" matches.
//
// Shared by the alert detail page (one alert, its own firing label sets) and
// the alerts home's flat firing view (one label set per row, across every
// rule) — extracted so both resolve "who gets notified" the same way.
import { isManagedCatchAllRoute } from "@/data/alerts/delivery-settings";
import type { CcRoute } from "@/data/cc/types";
import { ccFirstRoute } from "./route-resolution";

export type NotifiesDelivery = {
  email: { enabled: boolean };
  telegram: { enabled: boolean };
  slack: { enabled: boolean };
};

export function computeNotifiesChannels({
  delivery,
  routes,
  labelSets,
}: {
  delivery: NotifiesDelivery | undefined;
  routes: CcRoute[];
  labelSets: Record<string, string>[];
}): string[] {
  const defaults: string[] = [];
  if (delivery?.email.enabled) defaults.push("email");
  if (delivery?.telegram.enabled) defaults.push("telegram");
  if (delivery?.slack.enabled) defaults.push("slack");

  const customRoutes = routes.filter((r) => !isManagedCatchAllRoute(r));
  const custom: string[] = [];
  for (const labels of labelSets) {
    const match = ccFirstRoute(customRoutes, labels);
    if (match && !custom.includes(match.receiver)) custom.push(match.receiver);
  }
  // A custom route can be named after a default channel (e.g. a receiver
  // literally called "email"), so dedupe across both lists rather than just
  // within `custom`.
  return Array.from(new Set([...defaults, ...custom]));
}

export function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
