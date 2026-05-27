import { buttonVariants } from "@everr/ui/components/button";
import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorOccurrence } from "@/data/errors/types";

const TRACE_WINDOW_MS = 5 * 60 * 1000;

function getTraceWindow(timestamp: string): {
  start: string;
  end: string;
} {
  const parsed = parseTimestampAsUTC(timestamp) ?? new Date();
  return {
    start: toClickHouseDateTime(new Date(parsed.getTime() - TRACE_WINDOW_MS)),
    end: toClickHouseDateTime(new Date(parsed.getTime() + TRACE_WINDOW_MS)),
  };
}

export function TraceLink({
  occurrence,
  children = "Open trace",
}: {
  occurrence: ErrorOccurrence;
  children?: ReactNode;
}) {
  if (!occurrence.traceId) return null;

  const window = getTraceWindow(occurrence.timestamp);

  return (
    <Link
      to="/traces/$traceId"
      params={{ traceId: occurrence.traceId }}
      search={{
        span: occurrence.spanId || undefined,
        start: window.start,
        end: window.end,
      }}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <ExternalLink data-icon="inline-start" />
      {children}
    </Link>
  );
}
