import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import type { Tone } from "@everr/ui/components/tone";
import type { AlertEventType } from "@/data/alerting/history/event-types";
import type { AlertEventLogRow } from "@/data/alerting/history/repository.server";
import type {
  AlertingRuleCondition,
  AlertingRuleEvaluationSeries,
} from "@/data/alerting/types";
import type { AlertingLifecycleReason } from "@/data/alerting/vocabulary";
import {
  AlertingTableSkeleton,
  alertingErrorMessage,
  alertingFormatTs,
} from "../shared/components";
import { EvidenceChips, LabelSet } from "../shared/signal";
import { AlertingStatusLabel } from "../shared/status";
import { AlertRuleEvaluationHistoryTable } from "./evaluation-details";

const EVENT_META: Record<AlertEventType, { label: string; tone: Tone }> = {
  instance_pending: { label: "Pending", tone: "warning" },
  instance_fired: { label: "Fired", tone: "danger" },
  instance_resolved: { label: "Resolved", tone: "healthy" },
  // Closed ends the instance without a recovery, so it stays neutral rather
  // than borrowing the healthy tone of a resolve.
  instance_closed: { label: "Closed", tone: "muted" },
  delivery: { label: "Delivery", tone: "info" },
  rule_health: { label: "Rule health", tone: "warning" },
  silenced: { label: "Silenced", tone: "muted" },
  hold_changed: { label: "Hold changed", tone: "muted" },
  evaluation_failed: { label: "Evaluation failed", tone: "warning" },
};

function EventTypeLabel({ eventType }: { eventType: AlertEventType }) {
  const { label, tone } = EVENT_META[eventType];
  return <AlertingStatusLabel tone={tone}>{label}</AlertingStatusLabel>;
}

// The closing reasons a terminal row can carry. `condition_cleared` is not
// here on purpose: that is a plain resolve and the event label already says
// Resolved. Keyed over the closed vocabulary so a new reason cannot ship
// without a label.
const CLOSE_REASON_LABELS: Record<
  Exclude<AlertingLifecycleReason, "condition_cleared">,
  string
> = {
  pending_cleared: "Pending cleared",
  labels_changed: "Labels changed",
  rule_paused: "Rule paused",
  rule_deleted: "Rule deleted",
  preview_deleted: "Preview deleted",
};

function closeReasonLabel(reason: AlertingLifecycleReason | ""): string | null {
  if (reason === "" || reason === "condition_cleared") {
    return null;
  }
  return CLOSE_REASON_LABELS[reason];
}

function EventDetails({ event }: { event: AlertEventLogRow }) {
  const flags = [
    closeReasonLabel(event.reason),
    event.suppressed ? "Suppressed" : null,
    event.silenced ? "Silenced" : null,
    event.inhibited ? "Inhibited" : null,
  ].filter((flag): flag is string => flag !== null);
  const hasEvidence =
    (event.evidence !== null && Object.keys(event.evidence).length > 0) ||
    event.evidenceTruncated;
  if (
    flags.length === 0 &&
    event.deliveryTargets.length === 0 &&
    !hasEvidence
  ) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {flags.map((flag) => (
        <span key={flag} className="text-[0.6875rem] text-muted-foreground">
          {flag}
        </span>
      ))}
      {event.deliveryTargets.length > 0 && (
        <span className="text-[0.6875rem] text-muted-foreground">
          Sent to {event.deliveryTargets.join(", ")}
        </span>
      )}
      <EvidenceChips
        evidence={event.evidence}
        truncated={event.evidenceTruncated}
      />
    </div>
  );
}

function EventHistoryTable({
  events,
}: {
  events: readonly AlertEventLogRow[];
}) {
  return (
    <div className="max-h-[28rem] overflow-auto overscroll-contain border-t border-border/60">
      <table className="w-full min-w-[42rem] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium" scope="col">
              Time
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Event
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Labels
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Details
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {events.map((event, index) => (
            <tr
              key={`${event.instanceFingerprint}-${event.timestamp}-${event.eventType}-${index}`}
              className="h-8 hover:bg-muted/30"
            >
              <td className="whitespace-nowrap px-3 py-0 font-mono tabular-nums">
                {alertingFormatTs(event.timestamp)}
              </td>
              <td className="whitespace-nowrap px-3 py-0">
                <EventTypeLabel eventType={event.eventType} />
              </td>
              <td className="px-3 py-0">
                <LabelSet labels={event.labels} />
              </td>
              <td className="px-3 py-0">
                <EventDetails event={event} />
              </td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr>
              <td
                className="px-3 py-8 text-center text-muted-foreground"
                colSpan={4}
              >
                No events in range
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AlertRuleHistory({
  evaluationSeries,
  evaluationPending,
  evaluationError,
  condition,
  events,
  eventsPending,
  eventsError,
}: {
  evaluationSeries?: AlertingRuleEvaluationSeries;
  evaluationPending: boolean;
  evaluationError: unknown;
  condition: AlertingRuleCondition;
  events: readonly AlertEventLogRow[];
  eventsPending: boolean;
  eventsError: unknown;
}) {
  return (
    <Tabs defaultValue="evaluations" className="gap-0">
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>
            <h3>History</h3>
          </CardTitle>
          <CardAction>
            <TabsList aria-label="History view">
              <TabsTrigger value="evaluations">Evaluations</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>
          </CardAction>
        </CardHeader>
        <CardContent>
          <TabsContent value="evaluations">
            {evaluationPending ? (
              <AlertingTableSkeleton rows={6} />
            ) : evaluationError ? (
              <div className="border-t border-border/60 px-3 py-8 text-center text-destructive">
                Evaluation history unavailable (
                {alertingErrorMessage(evaluationError)}).
              </div>
            ) : evaluationSeries ? (
              <AlertRuleEvaluationHistoryTable
                evaluationSeries={evaluationSeries}
                condition={condition}
              />
            ) : null}
          </TabsContent>
          <TabsContent value="events">
            {eventsPending ? (
              <AlertingTableSkeleton rows={6} />
            ) : eventsError ? (
              <div className="border-t border-border/60 px-3 py-8 text-center text-destructive">
                Event history unavailable ({alertingErrorMessage(eventsError)}).
              </div>
            ) : (
              <EventHistoryTable events={events} />
            )}
          </TabsContent>
        </CardContent>
      </Card>
    </Tabs>
  );
}
