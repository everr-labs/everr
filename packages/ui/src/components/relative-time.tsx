import { useNow } from "../hooks/use-now";
import { formatRelativeTime } from "../lib/timestamp";

/** How long ago `timestamp` was, as "5m ago", moving on as the minutes pass. */
export function RelativeTime({ timestamp }: { timestamp: string }) {
  return formatRelativeTime(timestamp, useNow());
}
