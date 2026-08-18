import { buttonVariants } from "@everr/ui/components/button";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpenText } from "lucide-react";
import { alertingEventStatus } from "@/data/alerting/history/event-types";
import { alertHistoryQueries } from "@/data/alerting/history/queries";
import { fromAlertingRule } from "@/data/alerting/rules/resource/mapping";
import {
  alertingRunbookParams,
  TRIAGE_EVENT_RANGE,
  type TriageInstance,
} from "@/data/alerting/triage/summary";
import { alertingFormatTs } from "../common/format";
import { EvidenceChips } from "../common/labels";
import { AlertingStatusDot } from "../common/status";

const TRIAGE_INSTANCE_EVENT_LIMIT = 100;

export function TriageInstanceDetail({
  instance,
}: {
  instance: TriageInstance;
}) {
  const { alert, rule } = instance;
  const ownEvents = useQuery(
    alertHistoryQueries.events(TRIAGE_EVENT_RANGE, {
      fingerprint: alert.fingerprint,
      sourceId: alert.rule,
      // `rule` can be undefined for a raced or deleted rule; the fingerprint
      // and sourceId filters alone still scope this to one alert.
      ...(rule ? { repoid: rule.repoid } : {}),
      limit: TRIAGE_INSTANCE_EVENT_LIMIT,
    }),
  );
  const own = ownEvents.data ?? [];
  const latest = own.find(
    (event) => event.evidence && Object.keys(event.evidence).length > 0,
  );
  const transitions = own
    .filter((event) => alertingEventStatus(event.eventType) !== null)
    .slice(0, 6);
  const runbook = alertingRunbookParams(rule);
  const description = rule ? fromAlertingRule(rule).displayDescription : null;

  return (
    <div className="space-y-3 border-t border-border/60 bg-muted/10 px-3 py-3 pl-9">
      {description && (
        <p className="max-w-prose text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {latest?.evidence && (
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            Evidence
          </h3>
          <EvidenceChips
            evidence={latest.evidence}
            truncated={latest.evidenceTruncated}
          />
        </div>
      )}

      {instance.rule?.notifications && (
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            Notifications
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Direct channels</span>
            <span className="font-mono text-foreground">
              {instance.rule.notifications.channels.join(", ")}
            </span>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground">History</h3>
        {ownEvents.isPending ? (
          <Skeleton className="h-4 w-44" />
        ) : ownEvents.isError ? (
          <span className="text-xs text-muted-foreground">
            State history unavailable.
          </span>
        ) : transitions.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            No state changes in the last 24 hours.
          </span>
        ) : (
          <ul className="space-y-0.5">
            {transitions.map((event) => (
              <li
                key={`${event.timestamp}-${event.eventType}`}
                className="flex items-center gap-2 text-xs tabular-nums"
              >
                <AlertingStatusDot
                  tone={
                    alertingEventStatus(event.eventType) === "firing"
                      ? "danger"
                      : "muted"
                  }
                />
                <span className="w-14 text-muted-foreground">
                  {alertingEventStatus(event.eventType) ?? event.eventType}
                </span>
                <RelativeTime
                  timestamp={event.timestamp}
                  className="text-muted-foreground/80"
                  title={alertingFormatTs(event.timestamp)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          last seen{" "}
          {alert.last_seen ? <RelativeTime timestamp={alert.last_seen} /> : "—"}
        </span>
        {alert.absent_count > 0 && <span>absent x{alert.absent_count}</span>}
      </div>

      {runbook && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            to="/runbooks/$project/$slug"
            params={runbook}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "min-h-11 @[52rem]/triage:min-h-8",
            )}
          >
            <BookOpenText data-icon="inline-start" />
            Runbook
          </Link>
        </div>
      )}
    </div>
  );
}
