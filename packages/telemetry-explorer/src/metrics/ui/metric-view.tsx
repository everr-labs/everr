import { Badge } from "@everr/ui/components/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@everr/ui/components/empty";
import { RetryError } from "@everr/ui/components/retry-error";
import { type ChartMarker, type ChartSeries, SeriesChart } from "@everr/ui/components/series-chart";
import { Skeleton } from "@everr/ui/components/skeleton";
import { ACCENT_COLOR, SERIES_COLORS } from "@everr/ui/lib/series-colors";
import { ToggleGroup, ToggleGroupItem } from "@everr/ui/components/toggle-group";
import { ArrowLeft, X } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import { AttributeKeyPicker } from "../../attribute-filter/ui/attribute-key-picker";
import { attributeLabel } from "../../attribute-filter/ui/attribute-meta";
import { axisLabels } from "../../histogram/volume-histogram";
import type { GroupByKey, MetricAggregation, MetricViewMode } from "../data/schemas";
import {
  type BucketMergeNote,
  isHistogramKind,
  type MetricCatalogEntry,
  type MetricExemplar,
  type MetricKind,
  type MetricSeriesResult,
} from "../data/types";
import { ExemplarCard, type ExemplarLinkRenderProps } from "./exemplar-card";
import { formatMetricValue, temporalityLabel, unitName } from "./format";
import { MetricHeatmap } from "./metric-heatmap";
import { MetricKindBadge, MetricName, QueryTag } from "./metric-name";
import { MetricPicker, type MetricPickerProps } from "./metric-picker";

const MAX_GROUP_BY = 3;
const NO_EXCLUDED_KEYS: ReadonlySet<string> = new Set();

const count = new Intl.NumberFormat();

export function MetricView({
  metric,
  kind,
  entry,
  aggregations,
  aggregation,
  groupBy,
  result,
  exemplars,
  isPending,
  error,
  onRetry,
  attributeRepo,
  attributeDomain,
  timeRange,
  backLink,
  renderTraceLink,
  renderLogsLink,
  view,
  onViewChange,
  onAggregationChange,
  onGroupByChange,
  onRangeSelect,
  lines,
  metricPicker,
  queryRows,
  queryMetrics,
  addControls,
}: {
  metric: string;
  kind: MetricKind | null;
  entry: MetricCatalogEntry | undefined;
  aggregations: MetricAggregation[];
  aggregation: MetricAggregation | null;
  groupBy: GroupByKey[];
  result: MetricSeriesResult | undefined;
  /** Drawn on the chart when their values share its axis. */
  exemplars: MetricExemplar[] | undefined;
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  attributeRepo: AttributeRepositoryLike;
  attributeDomain: string;
  timeRange: { from: string; to: string };
  backLink: (props: { className: string; children: ReactNode }) => ReactNode;
  renderTraceLink: (props: ExemplarLinkRenderProps) => ReactNode;
  renderLogsLink: (props: ExemplarLinkRenderProps) => ReactNode;
  view: MetricViewMode;
  onViewChange: (view: MetricViewMode) => void;
  onAggregationChange: (aggregation: MetricAggregation) => void;
  onGroupByChange: (groupBy: GroupByKey[]) => void;
  onRangeSelect: (from: Date, to: Date) => void;
  /** What the chart draws: one line per series of each query. */
  lines: ChartLine[] | undefined;
  /** With several queries, one row each in place of the single query's controls. */
  /** The metric name opens it, to switch the chart to another metric. */
  metricPicker: MetricPickerProps;
  queryRows?: ReactNode;
  /** The metrics the query rows chart, named in the page's heading. */
  queryMetrics?: string[];
  /** "Add metric", after the single query's controls. */
  addControls?: ReactNode;
}) {
  const unit = entry?.unit ?? "";
  const temporality = entry ? temporalityLabel(entry.temporality) : null;
  const back = backLink({
    className:
      "text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs",
    children: (
      <>
        <ArrowLeft className="size-3" />
        All metrics
      </>
    ),
  });
  const resolution = result ? (
    <MetaItem label="Resolution">
      <span
        title={
          result.stepFromExport
            ? "One point per export: this metric is exported about this often, so a finer chart would only add empty intervals between exports."
            : "The chart's interval for this time range."
        }
      >
        {formatMetricValue(result.stepSeconds, "s")}
        {result.stepFromExport ? (
          <span className="text-muted-foreground"> · export interval</span>
        ) : null}
      </span>
    </MetaItem>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {queryRows ? (
        // Each query row names its own metric, so the header keeps only what
        // applies to every line: the shared interval.
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <h1 className="sr-only">{[...new Set(queryMetrics ?? [metric])].join(", ")}</h1>
          {back}
          {resolution ? <dl className="ml-auto flex items-center text-xs">{resolution}</dl> : null}
        </header>
      ) : (
        <header className="flex flex-col gap-2 border-b px-4 pt-3 pb-3">
          {back}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 font-mono text-base break-all">
              <MetricPicker
                {...metricPicker}
                label={`${metric}: change metric`}
                className="-mx-1.5 px-1.5 py-0.5"
              >
                <span>
                  <MetricName name={metric} />
                </span>
              </MetricPicker>
            </h1>
            {kind ? <MetricKindBadge kind={kind} /> : null}
          </div>
          {entry?.description ? (
            <p className="text-muted-foreground text-sm">{entry.description}</p>
          ) : null}
          {entry ? (
            <dl className="flex flex-wrap items-center gap-1.5 text-xs">
              {entry.unit ? (
                <MetaItem label="Unit">
                  <span title={`UCUM unit: ${entry.unit}`}>{unitName(entry.unit)}</span>
                </MetaItem>
              ) : null}
              {temporality ? <MetaItem label="Temporality">{temporality}</MetaItem> : null}
              {resolution}
            </dl>
          ) : null}
        </header>
      )}

      {queryRows ? (
        <div className="flex flex-col border-b">{queryRows}</div>
      ) : (
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-4 py-2">
          {view === "heatmap" ? (
            <span className="text-muted-foreground text-xs">
              Observations per bucket, every series added together
            </span>
          ) : (
            <QueryControls
              aggregations={aggregations}
              aggregation={aggregation}
              groupBy={groupBy}
              attributeRepo={attributeRepo}
              attributeDomain={attributeDomain}
              timeRange={timeRange}
              onAggregationChange={onAggregationChange}
              onGroupByChange={onGroupByChange}
            />
          )}
          <div className="ml-auto flex items-center gap-2">
            {view === "lines" ? addControls : null}
            {isHistogramKind(kind) ? (
              <ToggleGroup
                value={[view]}
                variant="outline"
                size="sm"
                spacing={0}
                onValueChange={(next) => {
                  if (next[0] === "lines" || next[0] === "heatmap") onViewChange(next[0]);
                }}
                aria-label="View"
              >
                <ToggleGroupItem value="lines" className="px-2.5">
                  Lines
                </ToggleGroupItem>
                <ToggleGroupItem value="heatmap" className="px-2.5">
                  Heatmap
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
          </div>
        </div>
      )}

      <SeriesPanel
        metric={metric}
        lines={lines}
        multi={Boolean(queryRows)}
        heatmapUnit={unit}
        view={view}
        aggregation={aggregation}
        groupBy={groupBy}
        result={result}
        exemplars={exemplars}
        isPending={isPending}
        error={error}
        onRetry={onRetry}
        onRangeSelect={onRangeSelect}
        renderTraceLink={renderTraceLink}
        renderLogsLink={renderLogsLink}
      />
    </div>
  );
}

export function QueryControls({
  aggregations,
  aggregation,
  groupBy,
  attributeRepo,
  attributeDomain,
  timeRange,
  onAggregationChange,
  onGroupByChange,
  showLabel = true,
}: {
  aggregations: MetricAggregation[];
  aggregation: MetricAggregation | null;
  groupBy: GroupByKey[];
  attributeRepo: AttributeRepositoryLike;
  attributeDomain: string;
  timeRange: { from: string; to: string };
  onAggregationChange: (aggregation: MetricAggregation) => void;
  onGroupByChange: (groupBy: GroupByKey[]) => void;
  /** Off in query rows, where the letter and metric already lead the row. */
  showLabel?: boolean;
}) {
  return (
    <>
      {showLabel ? <span className="text-muted-foreground text-xs">Show</span> : null}
      <ToggleGroup
        value={aggregation ? [aggregation] : []}
        variant="outline"
        size="sm"
        spacing={0}
        onValueChange={(next) => {
          const picked = aggregations.find((a) => a === next[0]);
          if (picked) onAggregationChange(picked);
        }}
        aria-label="Aggregation"
      >
        {aggregations.map((a) => (
          <ToggleGroupItem key={a} value={a} className="px-2.5">
            {a}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="text-muted-foreground ml-2 text-xs">by</span>
      {groupBy.map((key) => (
        <Badge key={`${key.source}:${key.key}`} variant="secondary" className="h-6 gap-1 pr-1">
          <span className="font-mono">{key.key}</span>
          <button
            type="button"
            aria-label={`Stop grouping by ${key.key}`}
            className="hover:text-foreground text-muted-foreground cursor-pointer rounded-sm"
            onClick={() =>
              onGroupByChange(groupBy.filter((k) => k.source !== key.source || k.key !== key.key))
            }
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {groupBy.length < MAX_GROUP_BY ? (
        <AttributeKeyPicker
          repo={attributeRepo}
          domain={attributeDomain}
          timeRange={timeRange}
          activeKeys={new Set(groupBy.map((k) => `${k.source}:${k.key}`))}
          promotedAttributes={[]}
          excludedKeys={NO_EXCLUDED_KEYS}
          sources={["metric", "resource"]}
          triggerLabel={groupBy.length === 0 ? "Group by" : "Add"}
          triggerClassName="h-6"
          onSelect={(key) => onGroupByChange([...groupBy, key])}
        />
      ) : null}
    </>
  );
}

function SeriesPanel({
  metric,
  lines,
  multi,
  heatmapUnit,
  view,
  aggregation,
  groupBy,
  result,
  exemplars,
  isPending,
  error,
  onRetry,
  onRangeSelect,
  renderTraceLink,
  renderLogsLink,
}: {
  metric: string;
  lines: ChartLine[] | undefined;
  /** Several queries: no exemplars, notes or group-by heading of one query. */
  multi: boolean;
  /** The metric's own unit, which labels the heatmap's buckets. */
  heatmapUnit: string;
  view: MetricViewMode;
  aggregation: MetricAggregation | null;
  groupBy: GroupByKey[];
  result: MetricSeriesResult | undefined;
  exemplars: MetricExemplar[] | undefined;
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  onRangeSelect: (from: Date, to: Date) => void;
  renderTraceLink: (props: ExemplarLinkRenderProps) => ReactNode;
  renderLogsLink: (props: ExemplarLinkRenderProps) => ReactNode;
}) {
  const [picked, setPicked] = useState<{
    exemplar: MetricExemplar;
    /** The charted value of its series in its interval. */
    lineValue: number | null;
    at: { x: number; y: number };
  } | null>(null);
  const chart = useMemo(() => {
    if (!result || !lines) return null;
    const step = result.stepSeconds * 1000;
    const buckets = result.buckets.map((timestamp) => ({
      timestamp,
      endTimestamp: new Date(Date.parse(timestamp) + step).toISOString(),
    }));
    // Lines in the first line's unit use the left axis; a second unit gets the
    // right one. A third shares the left axis, and the note says so.
    const scales: string[] = [];
    for (const line of lines) {
      const key = scaleKey(line);
      if (!scales.includes(key)) scales.push(key);
    }
    const formatOf = (line: ChartLine) => (value: number) =>
      formatMetricValue(value, line.unit, line.aggregation ?? undefined);
    const leftLine = lines[0];
    const rightLine = lines.find((line) => scaleKey(line) === scales[1]);
    const series = lines.map(
      (
        line,
        i,
      ): ChartSeries & {
        query?: { id: string; metric: string; aggregation: MetricAggregation | null };
        name: string;
        stats: SeriesStats;
        format: (v: number) => string;
      } => ({
        id: line.id,
        label: line.label,
        query: line.query,
        name: line.name,
        color: SERIES_COLORS[i % SERIES_COLORS.length] ?? ACCENT_COLOR,
        kind: "line",
        values: line.values,
        rightAxis: scales.length > 1 && scaleKey(line) === scales[1],
        stats: stats(line.values),
        format: formatOf(line),
      }),
    );
    return {
      labels: axisLabels(buckets),
      titles: buckets.map((b) =>
        new Date(b.timestamp).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      ),
      series,
      axes: {
        left: { format: leftLine ? formatOf(leftLine) : (v: number) => String(v) },
        ...(rightLine ? { right: { format: formatOf(rightLine) } } : {}),
      },
      buckets,
      sharedAxis: scales.length > 2,
    };
  }, [result, lines]);
  // Exemplars and the card read the single query's line.
  const format = chart?.series[0]?.format ?? ((value: number) => String(value));

  // Exemplars of the series on the chart, in their series' color. One whose
  // series was cut from the top ten has no line to sit on, so it is skipped.
  const markers = useMemo(() => {
    if (!chart || !exemplars) return [];
    const indexOf = new Map(chart.buckets.map((b, i) => [Date.parse(b.timestamp) / 1000, i]));
    const seriesOf = new Map(chart.series.map((s) => [s.id, s]));
    return exemplars.flatMap(
      (exemplar, n): (ChartMarker & { exemplar: MetricExemplar; lineValue: number | null })[] => {
        const index = indexOf.get(exemplar.ts);
        const series = seriesOf.get(exemplar.labels.join("\u0000") || metric);
        if (index === undefined || !series) return [];
        return [
          {
            id: String(n),
            index,
            value: exemplar.value,
            color: series.color,
            label: `Exemplar, trace ${exemplar.traceId.slice(0, 8)}`,
            exemplar,
            lineValue: series.values[index] ?? null,
          },
        ];
      },
    );
  }, [chart, exemplars, metric]);

  if (error) {
    return (
      <RetryError title="Couldn't load this metric" message={error.message} onRetry={onRetry} />
    );
  }
  if (isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!chart || chart.series.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>No data points match</EmptyTitle>
          <EmptyDescription>
            This metric reported nothing for these filters in the time range. Try fewer filters or a
            wider time range.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (view === "heatmap" && result?.heatmap) {
    return (
      <>
        <div className="px-4 pt-3 pb-3">
          <MetricHeatmap
            heatmap={result.heatmap}
            labels={chart.labels}
            titles={chart.titles}
            unit={heatmapUnit}
            className="h-[300px] w-full"
          />
        </div>
        <BucketMergeText merged={result.heatmap.merged} what="Bucket counts" />
      </>
    );
  }

  const hidden = multi ? 0 : (result?.totalSeries ?? 0) - chart.series.length;
  const groupHeading =
    !multi && groupBy.length > 0
      ? groupBy.map((k) => attributeLabel(k.key) ?? k.key).join(" · ")
      : "Series";

  return (
    <>
      <div className="px-4 pt-3 pb-1">
        <SeriesChart
          labels={chart.labels}
          titles={chart.titles}
          series={chart.series}
          axes={chart.axes}
          sparseLabels
          smooth={false}
          markers={markers}
          onMarkerClick={(marker, at) => {
            const hit = markers.find((m) => m.id === marker.id);
            if (hit) setPicked({ exemplar: hit.exemplar, lineValue: hit.lineValue, at });
          }}
          className="h-[260px] w-full"
          onSelect={(from, to) => {
            const start = chart.buckets[from];
            const end = chart.buckets[to];
            if (start && end) onRangeSelect(new Date(start.timestamp), new Date(end.endTimestamp));
          }}
        />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th className="px-4 py-1.5 text-left font-medium">{groupHeading}</th>
            {/* Fixed widths, so the series column takes the rest and the values sit together on the right. */}
            <th className="w-28 px-2 py-1.5 text-right font-medium">last</th>
            <th className="w-28 px-2 py-1.5 text-right font-medium">avg</th>
            <th className="w-28 px-4 py-1.5 text-right font-medium">max</th>
          </tr>
        </thead>
        <tbody>
          {chart.series.map((s, i) => (
            <Fragment key={s.id}>
              {s.query && s.query.id !== chart.series[i - 1]?.query?.id ? (
                <tr className="bg-muted/30 border-b">
                  <th scope="rowgroup" colSpan={4} className="px-4 py-1.5 text-left font-normal">
                    <span className="flex min-w-0 items-center gap-2 text-xs">
                      <QueryTag id={s.query.id} metric={s.query.metric} />
                      {s.query.aggregation ? (
                        <span className="text-muted-foreground shrink-0">
                          {s.query.aggregation}
                        </span>
                      ) : null}
                    </span>
                  </th>
                </tr>
              ) : null}
              <tr className="hover:bg-muted/50 border-b">
                <th
                  scope="row"
                  aria-label={s.label}
                  className="max-w-0 px-4 py-1.5 text-left font-normal"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: s.color }}
                    />
                    <span className="truncate font-mono text-xs" title={s.name}>
                      {s.name}
                    </span>
                  </span>
                </th>
                <StatCell value={s.stats.last} format={s.format} />
                <StatCell value={s.stats.avg} format={s.format} />
                <StatCell value={s.stats.max} format={s.format} className="pr-4" />
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      {picked ? (
        <ExemplarCard
          exemplar={picked.exemplar}
          at={picked.at}
          value={format(picked.exemplar.value)}
          charted={
            picked.lineValue !== null && aggregation
              ? { label: aggregation, value: format(picked.lineValue) }
              : null
          }
          groups={groupBy.map((g, i) => ({ key: g.key, value: picked.exemplar.labels[i] ?? "" }))}
          renderTraceLink={renderTraceLink}
          renderLogsLink={renderLogsLink}
          onClose={() => setPicked(null)}
        />
      ) : null}
      {!multi && (aggregation === "p50" || aggregation === "p95" || aggregation === "p99") ? (
        <BucketMergeText merged={result?.merged} what="Percentiles" />
      ) : null}
      {chart.sharedAxis ? (
        <p className="text-muted-foreground px-4 py-2 text-xs">
          Lines in more than two units: those beyond the first two share the left axis, so read
          their values from the table.
        </p>
      ) : null}
      {!multi && result?.highestOf ? (
        <p className="text-muted-foreground px-4 py-2 text-xs">
          {`Summary quantiles can't be combined across series, so each line shows the highest of up to ${result.highestOf} series. Group by an attribute such as service.instance.id to see each one.`}
        </p>
      ) : null}
      {hidden > 0 ? (
        <p className="text-muted-foreground px-4 py-2 text-xs">
          {`The ${chart.series.length} series with the highest values of ${count.format(result?.totalSeries ?? 0)}. Filter or group by fewer attributes to see the rest.`}
        </p>
      ) : null}
    </>
  );
}

/**
 * Says when series with different bucket bounds were combined, and how, so a
 * percentile isn't read as more exact than it is. avg and rate come from
 * Count and Sum, which add up exactly, so they need no note.
 */
function BucketMergeText({ merged, what }: { merged: BucketMergeNote | undefined; what: string }) {
  if (!merged) return null;
  const layouts = `${merged.layouts} different bucket layouts`;
  return (
    <p className="text-muted-foreground px-4 py-2 text-xs">
      {merged.merge === "shared"
        ? `Series use ${layouts}. ${what} use the bounds they all share, so they are exact but coarser.`
        : `Series use ${layouts}. ${what} combine them on every bound, assuming observations are spread evenly within each bucket, so they are estimates.`}
    </p>
  );
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-md border">
      <dt className="bg-muted text-muted-foreground border-r px-1.5 py-0.5">{label}</dt>
      <dd className="px-1.5 py-0.5">{children}</dd>
    </div>
  );
}

function StatCell({
  value,
  format,
  className = "",
}: {
  value: number | null;
  format: (value: number) => string;
  className?: string;
}) {
  return (
    <td className={`px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums ${className}`}>
      {value === null ? "—" : format(value)}
    </td>
  );
}

type SeriesStats = { last: number | null; avg: number | null; max: number | null };

function stats(values: readonly (number | null)[]): SeriesStats {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return { last: null, avg: null, max: null };
  return {
    last: present.at(-1) ?? null,
    avg: present.reduce((a, b) => a + b, 0) / present.length,
    max: Math.max(...present),
  };
}

/** One line on the chart: a series of a query. */
export type ChartLine = {
  id: string;
  /** The line's name, with its query's letter first when there are several. */
  label: string;
  /** With several queries, the line's query, which heads its group in the series list. */
  query?: { id: string; metric: string; aggregation: MetricAggregation | null };
  /** The series' group-by values, or the metric when it has none. */
  name: string;
  values: (number | null)[];
  /** The values' unit; a histogram's rate has none. */
  unit: string;
  aggregation: MetricAggregation | null;
};

// Lines that format the same way share an axis; a rate adds "/s".
function scaleKey(line: ChartLine): string {
  return `${line.unit}|${line.aggregation === "rate" ? "rate" : ""}`;
}

export function seriesLabel(labels: string[], metric: string): string {
  if (labels.length === 0) return metric;
  return labels.map((v) => (v === "" ? "(none)" : v)).join(" · ");
}
