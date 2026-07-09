import { Avatar, AvatarFallback } from "@everr/ui/components/avatar";
import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  formatRelativeTime,
  parseTimestampAsUTC,
} from "@everr/ui/lib/timestamp";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { errorTriageEventsOptions } from "../data/options";
import type { ErrorsRepositoryLike } from "../data/repository";
import type { ErrorTriageEvent } from "../data/types";
import type { ErrorTriageEventType } from "../events";
import { ErrorEventMarkdown } from "./error-event-markdown";
import {
  type CreateErrorInvestigation,
  ErrorInvestigationForm,
} from "./error-investigation-form";

const EVENT_LABELS: Record<ErrorTriageEventType, string> = {
  investigation: "recorded an Investigation",
  resolved: "resolved this Error",
  ignored: "ignored this Error",
  reopened: "reopened this Error",
};

function authorInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return initials || "?";
}

function TimelineEvent({ event }: { event: ErrorTriageEvent }) {
  const date = parseTimestampAsUTC(event.timestamp);
  return (
    <li className="flex gap-3 px-3 py-3">
      <Avatar size="sm" className="mt-0.5 shrink-0">
        <AvatarFallback>{authorInitials(event.author.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span className="font-medium">{event.author.name || "Unknown"}</span>
          <span className="text-muted-foreground">
            {EVENT_LABELS[event.type]}
          </span>
          <time
            dateTime={date?.toISOString()}
            title={event.timestamp}
            className="ml-auto whitespace-nowrap text-muted-foreground"
          >
            {formatRelativeTime(event.timestamp)}
          </time>
        </div>
        <div className="mt-1">
          <ErrorEventMarkdown>{event.body}</ErrorEventMarkdown>
        </div>
      </div>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="grid gap-3 px-3 py-3">
      {[0, 1].map((row) => (
        <div key={row} className="flex gap-3">
          <Skeleton className="size-6 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-48 max-w-full" />
            <Skeleton className="mt-2 h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorTimeline({
  repo,
  fingerprint,
  refresh,
  createInvestigation,
}: {
  repo: ErrorsRepositoryLike;
  fingerprint: string;
  refresh: string;
  createInvestigation?: CreateErrorInvestigation;
}) {
  const eventsQuery = useQuery(
    errorTriageEventsOptions(repo, { fingerprint, refresh }),
  );

  return (
    <section className="min-w-0 rounded-md border bg-background">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-medium">Timeline</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Investigations and status changes recorded for this Error, oldest
          first.
        </p>
      </div>

      {eventsQuery.isPending ? (
        <TimelineSkeleton />
      ) : eventsQuery.isError ? (
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
          <span>Failed to load the timeline.</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => eventsQuery.refetch()}
          >
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </div>
      ) : eventsQuery.data.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Nothing recorded yet. Write an Investigation to keep findings next to
          the telemetry, for the next person or Agent picking this up.
        </p>
      ) : (
        <ol className="divide-y">
          {eventsQuery.data.map((event) => (
            <TimelineEvent
              key={`${event.timestamp}|${event.author.id}|${event.type}`}
              event={event}
            />
          ))}
        </ol>
      )}

      {createInvestigation ? (
        <ErrorInvestigationForm
          fingerprint={fingerprint}
          createInvestigation={createInvestigation}
        />
      ) : null}
    </section>
  );
}
