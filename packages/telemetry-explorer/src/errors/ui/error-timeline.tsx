import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
import { Avatar, AvatarFallback } from "@everr/ui/components/avatar";
import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  formatRelativeTime,
  parseTimestampAsUTC,
} from "@everr/ui/lib/timestamp";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  errorTriageEventsOptions,
  errorTriageEventsQueryKey,
} from "../data/options";
import type { ErrorsRepositoryLike } from "../data/repository";
import type {
  CreateErrorInvestigationInput,
  CreateErrorStatusEventInput,
  DeleteErrorInvestigationInput,
  UpdateErrorInvestigationInput,
} from "../data/schemas";
import type { ErrorTriageEvent, ErrorTriageEventType } from "../data/types";
import { ErrorEventMarkdown } from "./error-event-markdown";
import { InvestigationComposer } from "./error-investigation-form";

// The app supplies the write surface (server functions on the web). The
// timeline renders only when provided: surfaces without triage capability
// (local/desktop for now) show no timeline at all.
export type ErrorTriageActions = {
  /** Session user id; gates the edit and delete affordances client-side. */
  currentUserId: string;
  createInvestigation: (
    input: CreateErrorInvestigationInput,
  ) => Promise<unknown>;
  updateInvestigation: (
    input: UpdateErrorInvestigationInput,
  ) => Promise<unknown>;
  deleteInvestigation: (
    input: DeleteErrorInvestigationInput,
  ) => Promise<unknown>;
  createStatusEvent: (input: CreateErrorStatusEventInput) => Promise<unknown>;
};

// Label tone mirrors the status badge palette so a Resolution or reopening
// stands out when scanning a long thread; Investigations stay quiet.
const EVENT_LABELS: Record<
  ErrorTriageEventType,
  { text: string; className: string }
> = {
  investigation: {
    text: "recorded an Investigation",
    className: "text-muted-foreground",
  },
  resolved: { text: "resolved this Error", className: "text-emerald-400" },
  ignored: { text: "ignored this Error", className: "text-muted-foreground" },
  reopened: { text: "reopened this Error", className: "text-amber-400" },
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

function DeleteEntryDialog({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete Investigation"
            title="Delete Investigation"
            disabled={pending}
          />
        }
      >
        <Trash2 />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this Investigation?</AlertDialogTitle>
          <AlertDialogDescription>
            It disappears from the timeline for everyone. The activity marker in
            the logs stays, without the content.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TimelineEvent({
  event,
  fingerprint,
  triage,
}: {
  event: ErrorTriageEvent;
  fingerprint: string;
  triage: ErrorTriageActions;
}) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: errorTriageEventsQueryKey(fingerprint),
    });

  const deleteMutation = useMutation({
    mutationFn: () => triage.deleteInvestigation({ eventId: event.id }),
    onSuccess: invalidate,
  });

  const own =
    event.type === "investigation" && event.author.id === triage.currentUserId;
  const date = parseTimestampAsUTC(event.timestamp);

  return (
    <li className="group/entry flex gap-3 px-3 py-3">
      <Avatar size="sm" className="mt-0.5 shrink-0">
        <AvatarFallback>{authorInitials(event.author.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-medium">{event.author.name || "Unknown"}</span>
          <span className={EVENT_LABELS[event.type].className}>
            {EVENT_LABELS[event.type].text}
          </span>
          {event.edited ? (
            <span
              className="text-muted-foreground"
              title={`Last edited ${event.updatedAt}`}
            >
              (edited)
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            {own && !editing ? (
              <span className="flex items-center opacity-0 transition-opacity group-focus-within/entry:opacity-100 group-hover/entry:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Edit Investigation"
                  title="Edit Investigation"
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </Button>
                <DeleteEntryDialog
                  pending={deleteMutation.isPending}
                  onConfirm={() => deleteMutation.mutate()}
                />
              </span>
            ) : null}
            <time
              dateTime={date?.toISOString()}
              title={event.timestamp}
              className="whitespace-nowrap text-muted-foreground"
            >
              {formatRelativeTime(event.timestamp)}
            </time>
          </span>
        </div>
        {deleteMutation.isError ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {deleteMutation.error instanceof Error
              ? deleteMutation.error.message
              : "Failed to delete the Investigation."}
          </p>
        ) : null}
        {editing ? (
          <div className="mt-1">
            <InvestigationComposer
              initialValue={event.body}
              placeholder="Update this Investigation."
              submitLabel="Save"
              autoFocus
              onSubmit={(body) =>
                triage.updateInvestigation({ eventId: event.id, body })
              }
              onSuccess={() => {
                setEditing(false);
                invalidate();
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : event.body ? (
          // Status changes may carry no note (ignore, reopen); the header
          // line is the whole entry then.
          <div className="mt-1">
            <ErrorEventMarkdown>{event.body}</ErrorEventMarkdown>
          </div>
        ) : null}
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
  triage,
}: {
  repo: ErrorsRepositoryLike;
  fingerprint: string;
  refresh: string;
  triage: ErrorTriageActions;
}) {
  const queryClient = useQueryClient();
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
              key={event.id}
              event={event}
              fingerprint={fingerprint}
              triage={triage}
            />
          ))}
        </ol>
      )}

      <div className="border-t p-3">
        <InvestigationComposer
          placeholder="Record an Investigation: what you found, what you ruled out, where to look next."
          submitLabel="Record Investigation"
          hint="Markdown supported. You can edit or delete your own entries."
          onSubmit={(body) => triage.createInvestigation({ fingerprint, body })}
          onSuccess={() =>
            queryClient.invalidateQueries({
              queryKey: errorTriageEventsQueryKey(fingerprint),
            })
          }
        />
      </div>
    </section>
  );
}
