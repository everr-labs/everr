import { withTimeRange } from "@everr/ui/lib/time-range";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertEventFeed,
  ccEventHistoryQueryOptions,
} from "@/components/cc/alert-event-feed";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/monitor/stream",
)({
  // The cc-alerting section hides the global time-range picker; this page reads
  // stored history, so it opts back in (the deepest staticData value wins).
  staticData: { hideTimeRangePicker: false },
  loaderDeps: ({ search }) => ({ timeRange: withTimeRange(search).timeRange }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.prefetchQuery(ccEventHistoryQueryOptions(deps.timeRange)),
  component: CcMonitorStream,
});

function CcMonitorStream() {
  return <AlertEventFeed />;
}
