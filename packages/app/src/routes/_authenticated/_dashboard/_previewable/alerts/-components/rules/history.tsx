import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@everr/ui/components/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import type { Tone } from "@everr/ui/components/tone";
import type { AlertTransitionEventType } from "@/data/alerting/history/event-types";
import type { AlertEventLogRow } from "@/data/alerting/history/repository.server";
import type {
  AlertingRuleCondition,
  AlertingRuleEvaluationSeries,
} from "@/data/alerting/types";
import type { AlertingLifecycleReason } from "@/data/alerting/vocabulary";
import { alertingFormatTs } from "../common/format";
import { EvidenceChips, LabelSet } from "../common/labels";
import {
  ALERTING_LOG_CELL,
  ALERTING_LOG_CELL_NUMERIC,
  AlertingLogTable,
} from "../common/log-table";
import { AlertingTableSkeleton } from "../common/placeholders";
import { alertingErrorMessage } from "../common/query-error";
import { SectionHeading } from "../common/section-heading";
import { AlertingStatusLabel } from "../common/status";
import { AlertRuleEvaluationHistoryTable } from "./evaluation-details";

// Keyed over AlertTransitionEventType, the exact set
// queryClickHouseAlertEventLog's WHERE clause can return: every entry here is
// reachable, and a new transition type is a compile error until it gets one.
const EVENT_META: Record<
  AlertTransitionEventType,
  { label: string; tone: Tone }
> = {
  instance_pending: { label: "Pending", tone: "warning" },
  instance_fired: { label: "Fired", tone: "danger" },
  instance_resolved: { label: "Resolved", tone: "healthy" },
  // Closed ends the instance without a recovery, so it stays neutral rather
  // than borrowing the healthy tone of a resolve.
  instance_closed: { label: "Closed", tone: "muted" },
};

function EventTypeLabel({
  eventType,
}: {
  eventType: AlertTransitionEventType;
}) {
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
  no_longer_firing: "No longer firing",
  no_channels: "No channels configured",
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
    <AlertingLogTable
      data={[...events]}
      columns={[
        {
          header: "Time",
          cell: (event) => alertingFormatTs(event.timestamp),
          cellClassName: ALERTING_LOG_CELL_NUMERIC,
        },
        {
          header: "Event",
          cell: (event) => <EventTypeLabel eventType={event.eventType} />,
          cellClassName: `whitespace-nowrap ${ALERTING_LOG_CELL}`,
        },
        {
          header: "Labels",
          cell: (event) => <LabelSet labels={event.labels} />,
        },
        {
          header: "Details",
          cell: (event) => <EventDetails event={event} />,
        },
      ]}
      rowKey={(event, index) =>
        `${event.instanceFingerprint}-${event.timestamp}-${event.eventType}-${index}`
      }
      emptyLabel="No events in range"
    />
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
          <SectionHeading level={3}>History</SectionHeading>
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
