import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { alertingDeliveryFanout } from "@/data/alerting/triage/summary";
import type { AlertingRoute } from "@/data/alerting/types";

export function TriageDeliveryFact({
  directChannels,
  matchedRoutes,
  channelsByReceiver,
}: {
  directChannels: string[];
  matchedRoutes: AlertingRoute[];
  channelsByReceiver: Map<string, string[]>;
}) {
  if (directChannels.length > 0) {
    const shown = directChannels.slice(0, 2);
    const names =
      shown.join(", ") +
      (directChannels.length > shown.length
        ? ` +${directChannels.length - shown.length}`
        : "");
    return (
      <span
        className="truncate font-mono text-xs text-muted-foreground"
        title={`Explicit destination: ${directChannels.join(", ")}`}
      >
        <span aria-hidden>→ </span>
        <span className="text-foreground">{names}</span>
      </span>
    );
  }
  if (matchedRoutes.length === 0) {
    return (
      <Link
        to="/alerts/delivery"
        hash="routes"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "inline-flex min-h-11 items-center whitespace-nowrap text-xs underline-offset-2 hover:underline @[52rem]/triage:min-h-0",
          toneText({ tone: "warning" }),
        )}
      >
        Not delivered
      </Link>
    );
  }
  const { receivers, channels, dead } = alertingDeliveryFanout(
    matchedRoutes,
    channelsByReceiver,
  );
  const shown = receivers.slice(0, 2);
  const names =
    shown.join(", ") +
    (receivers.length > shown.length
      ? ` +${receivers.length - shown.length}`
      : "");
  if (channels.length === 0) {
    return (
      <Link
        to="/alerts/delivery"
        hash="receivers"
        onClick={(event) => event.stopPropagation()}
        title={receivers.join(", ")}
        className={cn(
          "inline-flex min-h-11 items-center whitespace-nowrap text-xs underline-offset-2 hover:underline @[52rem]/triage:min-h-0",
          toneText({ tone: "warning" }),
        )}
      >
        No destination
      </Link>
    );
  }
  return (
    <span
      className="truncate font-mono text-xs text-muted-foreground"
      title={[
        receivers.join(", "),
        channels.join(", "),
        dead.length > 0 ? `no channels: ${dead.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <span aria-hidden>→ </span>
      <span className="text-foreground">{names}</span>
    </span>
  );
}
