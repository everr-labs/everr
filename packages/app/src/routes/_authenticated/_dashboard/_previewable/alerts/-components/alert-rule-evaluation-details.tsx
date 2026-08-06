import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { useState } from "react";
import { alertingConditionOperatorLabel } from "@/data/alerting/condition";
import type {
  AlertingRuleCondition,
  AlertingRuleEvaluationPoint,
  AlertingRuleEvaluationSeries,
} from "@/data/alerting/types";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import {
  type AlertRuleEvaluationOutcome,
  alertRuleEvaluationOutcome,
  alertRuleRailBucketCount,
  buildAlertRuleEvaluationRail,
  buildAlertRuleIncidentRail,
} from "./alert-rule-chart-data";
import { alertingFormatTs } from "./shared";

const OUTCOME_META: Record<
  AlertRuleEvaluationOutcome,
  { label: string; bar: string; dot: string; text: string }
> = {
  healthy: {
    label: "Healthy",
    bar: "bg-emerald-500/75",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  breached: {
    label: "Breached",
    bar: "bg-destructive/80",
    dot: "bg-destructive",
    text: "text-destructive",
  },
  no_data: {
    label: "No data",
    bar: "bg-muted-foreground/30",
    dot: "bg-muted-foreground/45",
    text: "text-muted-foreground",
  },
  failed: {
    label: "Failed",
    bar: "bg-amber-500/80",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  unknown: {
    label: "Not recorded",
    bar: "bg-muted-foreground/15",
    dot: "bg-muted-foreground/25",
    text: "text-muted-foreground",
  },
};

function EvaluationOutcomeLabel({
  outcome,
}: {
  outcome: AlertRuleEvaluationOutcome;
}) {
  const meta = OUTCOME_META[outcome];
  return (
    <span className={cn("inline-flex items-center gap-1.5", meta.text)}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

function formatWindow(start: number, end: number) {
  return `${alertingFormatTs(start)} to ${alertingFormatTs(end)}`;
}

type RailBucket = {
  className: string;
  key: number;
  label: string;
  window: string;
};

function BucketRail({
  buckets,
  className,
}: {
  buckets: readonly RailBucket[];
  className: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeBucket = buckets[activeIndex] ?? buckets[0];

  if (!activeBucket) return null;

  return (
    <Tooltip trackCursorAxis="x">
      <TooltipTrigger
        render={
          <div
            aria-hidden
            className={cn(
              "grid gap-px overflow-hidden rounded-[2px] bg-muted/40",
              className,
            )}
            style={{
              gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
            }}
          >
            {buckets.map((bucket, index) => (
              <span
                key={bucket.key}
                className={bucket.className}
                onPointerEnter={() => setActiveIndex(index)}
              />
            ))}
          </div>
        }
      />
      <TooltipContent className="max-w-72 space-y-0.5">
        <div className="font-medium">{activeBucket.label}</div>
        <div className="text-background/70">{activeBucket.window}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function StateRails({
  evaluationSeries,
  condition,
  events,
  currentFiringFingerprints,
  domain,
  intervalSeconds,
}: {
  evaluationSeries: AlertingRuleEvaluationSeries;
  condition: AlertingRuleCondition;
  events: readonly AlertEventLogRow[];
  currentFiringFingerprints: readonly string[];
  domain: [number, number];
  intervalSeconds: number;
}) {
  const bucketCount = alertRuleRailBucketCount(domain, intervalSeconds * 1_000);
  const evaluationBuckets = buildAlertRuleEvaluationRail(
    evaluationSeries.points,
    condition,
    domain,
    bucketCount,
  );
  const incidentBuckets = buildAlertRuleIncidentRail(
    events,
    currentFiringFingerprints,
    domain,
    bucketCount,
  );
  const evaluationRail = evaluationBuckets.map((bucket) => ({
    className: bucket.outcome
      ? OUTCOME_META[bucket.outcome].bar
      : "bg-transparent",
    key: bucket.start,
    label: bucket.outcome
      ? `${OUTCOME_META[bucket.outcome].label}, ${bucket.evaluations} evaluation${bucket.evaluations === 1 ? "" : "s"}`
      : "No recorded check",
    window: formatWindow(bucket.start, bucket.end),
  }));
  const incidentRail = incidentBuckets.map((bucket) => ({
    className:
      bucket.activeInstances > 0 ? "bg-destructive/75" : "bg-transparent",
    key: bucket.start,
    label:
      bucket.activeInstances > 0
        ? `${bucket.activeInstances} firing instance${bucket.activeInstances === 1 ? "" : "s"}`
        : "No active alerts",
    window: formatWindow(bucket.start, bucket.end),
  }));
  const counts = evaluationSeries.points.reduce(
    (result, point) => {
      result[alertRuleEvaluationOutcome(point, condition)] += 1;
      return result;
    },
    { healthy: 0, breached: 0, no_data: 0, failed: 0, unknown: 0 },
  );
  const firingPeriodCount = incidentBuckets.reduce(
    (periods, bucket, index) =>
      bucket.activeInstances > 0 &&
      (incidentBuckets[index - 1]?.activeInstances ?? 0) === 0
        ? periods + 1
        : periods,
    0,
  );

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">
        Rule checks and firing state over time
      </legend>
      <div className="space-y-0.5">
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
          <span className="text-right text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
            Checks
          </span>
          <BucketRail buckets={evaluationRail} className="h-2" />
        </div>
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
          <span className="text-right text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
            Firing
          </span>
          <BucketRail buckets={incidentRail} className="h-2" />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 pl-[5rem] text-[0.6875rem] text-muted-foreground">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(OUTCOME_META) as AlertRuleEvaluationOutcome[]).map(
            (outcome) =>
              counts[outcome] > 0 && (
                <li key={outcome} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      OUTCOME_META[outcome].dot,
                    )}
                  />
                  {OUTCOME_META[outcome].label} {counts[outcome]}
                </li>
              ),
          )}
        </ul>
        <span>
          {firingPeriodCount > 0
            ? `${firingPeriodCount} firing period${firingPeriodCount === 1 ? "" : "s"}`
            : "No firing periods"}
        </span>
      </div>
      <p className="sr-only">
        Evaluation outcomes: {counts.healthy} healthy, {counts.breached}{" "}
        breached, {counts.no_data} with no data, {counts.failed} failed, and{" "}
        {counts.unknown} without recorded samples. {firingPeriodCount} firing{" "}
        {firingPeriodCount === 1 ? "period" : "periods"} represented.
      </p>
    </fieldset>
  );
}

function valueSummary(
  point: AlertingRuleEvaluationPoint,
  condition: AlertingRuleCondition,
) {
  const values = point.samples.flatMap((sample) =>
    sample.value === null ? [] : [sample.value],
  );
  if (values.length === 0) return "—";
  const breached = values.filter(
    (value) =>
      alertRuleEvaluationOutcome(
        { ...point, samples: [{ fingerprint: "", labels: {}, value }] },
        condition,
      ) === "breached",
  ).length;
  if (values.length === 1) {
    return `${values[0]} ${alertingConditionOperatorLabel(condition.operator)} ${condition.threshold}`;
  }
  return `${breached}/${values.length} breached`;
}

export function AlertRuleEvaluationHistoryTable({
  evaluationSeries,
  condition,
}: {
  evaluationSeries: AlertingRuleEvaluationSeries;
  condition: AlertingRuleCondition;
}) {
  const rows = [...evaluationSeries.recent_points].reverse();
  return (
    <div className="max-h-[28rem] overflow-auto overscroll-contain border-t border-border/60">
      <table className="w-full min-w-[42rem] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium" scope="col">
              Time
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Outcome
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Value / threshold
            </th>
            <th className="px-3 py-2 text-right font-medium" scope="col">
              Rows
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Details
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((point) => {
            const outcome = alertRuleEvaluationOutcome(point, condition);
            return (
              <tr key={point.t} className="h-8 hover:bg-muted/30">
                <td className="whitespace-nowrap px-3 py-0 font-mono tabular-nums">
                  {alertingFormatTs(point.t)}
                </td>
                <td className="whitespace-nowrap px-3 py-0">
                  <EvaluationOutcomeLabel outcome={outcome} />
                </td>
                <td className="whitespace-nowrap px-3 py-0 font-mono tabular-nums">
                  {valueSummary(point, condition)}
                </td>
                <td className="px-3 py-0 text-right font-mono tabular-nums">
                  {point.row_count ?? "—"}
                </td>
                <td
                  className="max-w-80 truncate px-3 py-0 text-muted-foreground"
                  title={point.error ?? undefined}
                >
                  {point.error ??
                    (outcome === "no_data"
                      ? "Query returned no numeric values"
                      : outcome === "unknown"
                        ? "Evaluation predates captured samples"
                        : "—")}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td
                className="px-3 py-8 text-center text-muted-foreground"
                colSpan={5}
              >
                No evaluations in range
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AlertRuleEvaluationDetails({
  evaluationSeries,
  condition,
  events,
  currentFiringFingerprints,
  domain,
  intervalSeconds,
}: {
  evaluationSeries: AlertingRuleEvaluationSeries;
  condition: AlertingRuleCondition;
  events: readonly AlertEventLogRow[];
  currentFiringFingerprints: readonly string[];
  domain: [number, number];
  intervalSeconds: number;
}) {
  return (
    <StateRails
      evaluationSeries={evaluationSeries}
      condition={condition}
      events={events}
      currentFiringFingerprints={currentFiringFingerprints}
      domain={domain}
      intervalSeconds={intervalSeconds}
    />
  );
}
