import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";

export function TriageDeliveryFact({
  directChannels,
  defaultChannels,
}: {
  directChannels: string[];
  /** The default-destination channels this instance's severity resolves to. */
  defaultChannels: string[];
}) {
  const channels = directChannels.length > 0 ? directChannels : defaultChannels;
  if (channels.length === 0) {
    return (
      <Link
        to="/alerts/notifications"
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
  const shown = channels.slice(0, 2);
  const names =
    shown.join(", ") +
    (channels.length > shown.length
      ? ` +${channels.length - shown.length}`
      : "");
  return (
    <span
      className="truncate font-mono text-xs text-muted-foreground"
      title={
        directChannels.length > 0
          ? `Direct channels: ${channels.join(", ")}`
          : `Default destination: ${channels.join(", ")}`
      }
    >
      <span aria-hidden>→ </span>
      <span className="text-foreground">{names}</span>
    </span>
  );
}
