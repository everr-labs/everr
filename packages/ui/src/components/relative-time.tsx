import { formatRelativeTime } from "../lib/timestamp";

/**
 * Relative timestamp as text. `formatRelativeTime` reads the clock, so the
 * server-rendered text can differ from the client's first render when the
 * value ticks over between the two, so suppressHydrationWarning scopes the
 * expected mismatch to this text node.
 */
export function RelativeTime({
  timestamp,
  className,
  title,
}: {
  timestamp: string;
  className?: string;
  /** Conventionally the absolute datetime, kept reachable on hover. */
  title?: string;
}) {
  return (
    <span suppressHydrationWarning className={className} title={title}>
      {formatRelativeTime(timestamp)}
    </span>
  );
}
