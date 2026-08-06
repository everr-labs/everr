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
  createTimeTickFormatter,
  generateTimeTicks,
  niceLinearDomain,
} from "@/components/dashboards/visualizations/data-utils";
import { alertingConditionOperatorLabel } from "@/data/alerting/condition";
import type {
  AlertingRuleCondition,
  AlertingRuleEvaluationSeries,
} from "@/data/alerting/types";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { buildAlertRuleChartModel } from "./alert-rule-chart-data";

const FIRING_COLOR = "var(--color-red-500)";
const RESOLVED_COLOR = "var(--color-green-500)";
const THRESHOLD_COLOR = "var(--color-orange-500)";

function conditionLabel(condition: AlertingRuleCondition) {
  return `value ${alertingConditionOperatorLabel(condition.operator)} ${condition.threshold}`;
}

function transitionEvents(events: readonly AlertEventLogRow[]) {
  const seen = new Set<string>();
  return events.flatMap((event) => {
    const type =
      event.eventType === "instance_fired"
        ? ("firing" as const)
        : event.eventType === "instance_resolved"
          ? ("resolved" as const)
          : null;
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
  fired,
  resolved,
}: {
  model: ReturnType<typeof buildAlertRuleChartModel>;
  condition: AlertingRuleCondition;
  fired: number;
  resolved: number;
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
          {conditionLabel(condition)}
        </li>
        {fired > 0 && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-px"
              style={{ backgroundColor: FIRING_COLOR }}
            />
            {fired} fired
          </li>
        )}
        {resolved > 0 && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-px"
              style={{ backgroundColor: RESOLVED_COLOR }}
            />
            {resolved} resolved
          </li>
        )}
      </ul>
    </div>
  );
}

export function AlertRuleSignalChart({
  evaluationSeries,
  events,
  condition,
  timeRange,
}: {
  evaluationSeries: AlertingRuleEvaluationSeries;
  events: readonly AlertEventLogRow[];
  condition: AlertingRuleCondition;
  timeRange: TimeRange;
}) {
  const model = buildAlertRuleChartModel(evaluationSeries.points);
  const transitions = transitionEvents(events);
  const fired = transitions.filter((event) => event.type === "firing").length;
  const resolved = transitions.length - fired;
  const values = model.rows.flatMap((row) =>
    model.series.flatMap((series) => {
      const value = row[series.key];
      return typeof value === "number" ? [value] : [];
    }),
  );

  if (values.length === 0) {
    return (
      <ChartEmptyState message="No recorded evaluation values in this range yet" />
    );
  }

  const { fromDate, toDate } = resolveTimeRange(timeRange);
  const domain: [number, number] = [fromDate.getTime(), toDate.getTime()];
  const yAxis = niceLinearDomain(
    Math.min(condition.threshold, ...values),
    Math.max(condition.threshold, ...values),
  );
  const chartConfig: ChartConfig = Object.fromEntries(
    model.series.map((series) => [
      series.key,
      { label: series.label, color: series.color },
    ]),
  );
  const firingAbove =
    condition.operator === "gt" || condition.operator === "gte";
  const firingBelow =
    condition.operator === "lt" || condition.operator === "lte";
  const failedEvaluations = model.rows.filter((row) => row.failed).length;

  return (
    <div className="space-y-3">
      <ChartContainer config={chartConfig} className="h-72 w-full">
        <ComposedChart
          data={model.rows}
          margin={{ top: 20, right: 16, left: 4 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            ticks={generateTimeTicks(domain, 6)}
            tickFormatter={createTimeTickFormatter(domain)}
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
          {firingAbove && (
            <ReferenceArea
              y1={condition.threshold}
              y2={yAxis.domain[1]}
              fill={FIRING_COLOR}
              fillOpacity={0.06}
              strokeOpacity={0}
            />
          )}
          {firingBelow && (
            <ReferenceArea
              y1={yAxis.domain[0]}
              y2={condition.threshold}
              fill={FIRING_COLOR}
              fillOpacity={0.06}
              strokeOpacity={0}
            />
          )}
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
            content={
              <ChartTooltipContent
                formatter={createChartTooltipFormatter(chartConfig)}
                labelFormatter={(_, payload) => {
                  const t = payload?.[0]?.payload?.t;
                  return typeof t === "number"
                    ? new Date(t).toLocaleString()
                    : "";
                }}
              />
            }
          />
          {model.series.map((series) => (
            <Line
              key={series.key}
              dataKey={series.key}
              name={series.key}
              type="monotone"
              stroke={series.color}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          <ReferenceLine
            y={condition.threshold}
            stroke={THRESHOLD_COLOR}
            strokeDasharray="5 4"
            strokeWidth={1.5}
          />
          {transitions.map((event) => (
            <ReferenceLine
              key={event.key}
              x={event.t}
              stroke={event.type === "firing" ? FIRING_COLOR : RESOLVED_COLOR}
              strokeDasharray="2 3"
              strokeOpacity={0.72}
            />
          ))}
        </ComposedChart>
      </ChartContainer>

      <ChartKey
        model={model}
        condition={condition}
        fired={fired}
        resolved={resolved}
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

      <ul className="sr-only" aria-label="Alert transitions in range">
        {transitions.map((event) => (
          <li key={`accessible-${event.key}`}>
            {event.type === "firing" ? "Fired" : "Resolved"} at{" "}
            {new Date(event.t).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
