import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import {
  ChartEmptyState,
  createChartTooltipFormatter,
} from "@everr/ui/components/chart-helpers";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  generateTimeTicks,
  niceLinearDomain,
} from "@/components/dashboards/visualizations/data-utils";
import { alertingEventStatus } from "@/data/alerting/history/event-types";
import type { AlertEventLogRow } from "@/data/alerting/history/repository.server";
import { alertingConditionOperatorLabel } from "@/data/alerting/rules/condition";
import type {
  AlertingRuleCondition,
  AlertingRuleEvaluationSeries,
} from "@/data/alerting/types";
import { alertingFormatTs } from "../shared/components";
import {
  buildAlertRuleChartModel,
  buildAlertRuleEvaluationSpans,
} from "./chart-data";
import { AlertRuleEvaluationDetails } from "./evaluation-details";

const THRESHOLD_COLOR = "var(--destructive)";

function conditionLabel(condition: AlertingRuleCondition) {
  return `value ${alertingConditionOperatorLabel(condition.operator)} ${condition.threshold}`;
}

function conditionLegendLabel(condition: AlertingRuleCondition) {
  switch (condition.operator) {
    case "gt":
      return "Breach above";
    case "gte":
      return "Breach at or above";
    case "lt":
      return "Breach below";
    case "lte":
      return "Breach at or below";
    case "eq":
      return "Breach at threshold";
    case "neq":
      return "Breach except at threshold";
  }
}

function createAlertTimeTickFormatter(domain: [number, number]) {
  const multiDay = domain[1] - domain[0] > 86_400_000;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    ...(multiDay
      ? { day: "2-digit", month: "short" }
      : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  });
  return (timestamp: number) => formatter.format(new Date(timestamp));
}

function transitionEvents(events: readonly AlertEventLogRow[]) {
  const seen = new Set<string>();
  return events.flatMap((event) => {
    const type = alertingEventStatus(event.eventType);
    if (!type) return [];
    const t = Date.parse(event.timestamp);
    if (!Number.isFinite(t)) return [];
    const key = `${t}:${type}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, t, type }];
  });
}

function ChartKey({
  model,
  condition,
}: {
  model: ReturnType<typeof buildAlertRuleChartModel>;
  condition: AlertingRuleCondition;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 text-[0.6875rem] text-muted-foreground">
      <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {model.series.map((series) => (
          <li key={series.key} className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-4 shrink-0"
              style={{ backgroundColor: series.color }}
            />
            <span className="max-w-56 truncate" title={series.label}>
              {series.label}
            </span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0.5 w-4 border-t border-dashed"
            style={{ borderColor: THRESHOLD_COLOR }}
          />
          {conditionLegendLabel(condition)}
        </li>
      </ul>
    </div>
  );
}

export function AlertRuleSignalChart({
  evaluationSeries,
  events,
  condition,
  timeRange,
  intervalSeconds,
  currentFiringFingerprints,
}: {
  evaluationSeries: AlertingRuleEvaluationSeries;
  events: readonly AlertEventLogRow[];
  condition: AlertingRuleCondition;
  timeRange: TimeRange;
  intervalSeconds: number;
  currentFiringFingerprints: readonly string[];
}) {
  const model = buildAlertRuleChartModel(evaluationSeries.points);
  const transitions = transitionEvents(events);
  const values = model.rows.flatMap((row) =>
    model.series.flatMap((series) => {
      const value = row[series.key];
      return typeof value === "number" ? [value] : [];
    }),
  );
  const failedEvaluations = model.rows.filter((row) => row.failed).length;
  const { fromDate, toDate } = resolveTimeRange(timeRange);
  const domain: [number, number] = [fromDate.getTime(), toDate.getTime()];
  const samplePointCount = evaluationSeries.points.filter((point) =>
    point.samples.some((sample) => sample.value !== null),
  ).length;
  const visibleTransitions = transitions.filter(
    (event) => event.t >= domain[0] && event.t <= domain[1],
  );
  const yAxis =
    values.length > 0
      ? niceLinearDomain(
          Math.min(condition.threshold, ...values),
          Math.max(condition.threshold, ...values),
        )
      : null;
  const chartConfig: ChartConfig = Object.fromEntries(
    model.series.map((series) => [
      series.key,
      { label: series.label, color: series.color },
    ]),
  );
  const latestObservedRow = [...model.rows]
    .reverse()
    .find((row) =>
      model.series.some((series) => typeof row[series.key] === "number"),
    );
  const latestValues = model.series.flatMap((series) => {
    const value = latestObservedRow?.[series.key];
    return typeof value === "number" ? [{ label: series.label, value }] : [];
  });
  const chartSummary =
    values.length > 0
      ? [
          `Signal history. Condition: ${conditionLabel(condition)}.`,
          `Observed minimum ${Math.min(...values)} and maximum ${Math.max(...values)}.`,
          latestValues.length > 0
            ? `Latest values: ${latestValues.map(({ label, value }) => `${label}: ${value}`).join(", ")}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : "Signal history has no numeric values in this range.";
  const evaluationSpans = buildAlertRuleEvaluationSpans(
    evaluationSeries.points,
    condition,
    domain,
    intervalSeconds * 1_000,
  );

  return (
    <>
      <div className="space-y-3">
        {values.length === 0 || yAxis === null ? (
          <div className="h-44 sm:h-72">
            <ChartEmptyState
              message={
                failedEvaluations > 0
                  ? `No values recorded; ${failedEvaluations} evaluation${failedEvaluations === 1 ? "" : "s"} failed in this range`
                  : "No recorded numeric values in this range"
              }
            />
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-60 w-full rounded-sm outline-2 outline-transparent outline-offset-2 focus-visible:outline-primary sm:h-72"
            role="img"
            tabIndex={0}
            aria-label={chartSummary}
          >
            <ComposedChart
              data={model.rows}
              margin={{ top: 20, right: 16, left: 4 }}
            >
              <defs>
                <pattern
                  id="alert-no-data-hatch"
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    stroke="var(--muted-foreground)"
                    strokeOpacity="0.18"
                    strokeWidth="1"
                  />
                </pattern>
                <pattern
                  id="alert-failed-hatch"
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    stroke="var(--color-amber-500)"
                    strokeOpacity="0.3"
                    strokeWidth="1.5"
                  />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={domain}
                allowDataOverflow
                ticks={generateTimeTicks(domain, 6)}
                tickFormatter={createAlertTimeTickFormatter(domain)}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                domain={yAxis.domain}
                ticks={yAxis.ticks}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={48}
              />
              {evaluationSpans.map((span) => (
                <ReferenceArea
                  key={`${span.start}:${span.outcome}`}
                  x1={span.start}
                  x2={span.end}
                  y1={yAxis.domain[0]}
                  y2={yAxis.domain[1]}
                  fill={`url(#alert-${span.outcome === "no_data" ? "no-data" : "failed"}-hatch)`}
                  strokeOpacity={0}
                />
              ))}
              <ChartTooltip
                cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                content={
                  <ChartTooltipContent
                    formatter={createChartTooltipFormatter(chartConfig)}
                    labelFormatter={(_, payload) => {
                      const t = payload?.[0]?.payload?.t;
                      return typeof t === "number" ? alertingFormatTs(t) : "";
                    }}
                  />
                }
              />
              <ReferenceLine
                y={condition.threshold}
                stroke={THRESHOLD_COLOR}
                strokeDasharray="5 4"
                strokeWidth={1.5}
              />
              {model.series.map((series) => (
                <Line
                  key={series.key}
                  dataKey={series.key}
                  name={series.key}
                  type="linear"
                  stroke={series.color}
                  strokeWidth={2}
                  dot={samplePointCount === 1 ? { r: 3 } : false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ChartContainer>
        )}

        {values.length > 0 && <ChartKey model={model} condition={condition} />}

        <AlertRuleEvaluationDetails
          evaluationSeries={evaluationSeries}
          condition={condition}
          events={events}
          currentFiringFingerprints={currentFiringFingerprints}
          domain={domain}
          intervalSeconds={intervalSeconds}
        />

        {(evaluationSeries.samples_truncated ||
          model.seriesTruncated ||
          failedEvaluations > 0) && (
          <p className="text-xs text-muted-foreground">
            {[
              evaluationSeries.samples_truncated
                ? "Some evaluations exceeded the stored sample limit"
                : null,
              model.seriesTruncated
                ? "Showing the 12 most frequently observed label sets"
                : null,
              failedEvaluations > 0
                ? `${failedEvaluations} failed evaluation${failedEvaluations === 1 ? "" : "s"} shown as gaps`
                : null,
            ]
              .filter(Boolean)
              .join(". ")}
            .
          </p>
        )}
      </div>

      <ul className="sr-only" aria-label="Alert transitions in range">
        {visibleTransitions.map((event) => (
          <li key={`accessible-${event.key}`}>
            {event.type === "firing" ? "Fired" : "Resolved"} at{" "}
            {alertingFormatTs(event.t)}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Latest recorded values by label set</caption>
        <thead>
          <tr>
            <th scope="col">Label set</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {latestValues.map(({ label, value }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
