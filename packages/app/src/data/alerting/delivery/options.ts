import type { TimeRange } from "@everr/ui/lib/time-range";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { invalidateAlertTriage } from "@/data/alerting/triage/options";
import { getAlertNotifications } from "./server";

const notificationsQueryKey = ["alerting", "notifications"] as const;

export const alertNotificationsOptions = (range: TimeRange) =>
  queryOptions({
    // The range is part of the key: the delivery record on every row is
    // scoped to it, so a range change has to refetch rather than serve the
    // old window.
    queryKey: [...notificationsQueryKey, range.from, range.to],
    queryFn: () => getAlertNotifications({ data: range }),
  });

/**
 * After any write on the page. Triage rides along: its rows say "no channel
 * for this rule" from the same default tiers, so a destination change has
 * to reach that board too.
 */
export const invalidateAlertNotifications = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
    invalidateAlertTriage(queryClient),
  ]);
