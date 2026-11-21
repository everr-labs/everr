import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@everr/ui/components/empty";
import { RetryError } from "@everr/ui/components/retry-error";
import { type ChartMarker, type ChartSeries, SeriesChart } from "@everr/ui/components/series-chart";
import { Skeleton } from "@everr/ui/components/skeleton";
import { ACCENT_COLOR, SERIES_COLORS } from "@everr/ui/lib/series-colors";
import { ToggleGroup, ToggleGroupItem } from "@everr/ui/components/toggle-group";
import { cn } from "@everr/ui/lib/utils";
import { ArrowLeft, Plus, X } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import { AttributeKeyPicker } from "../../attribute-filter/ui/attribute-key-picker";
import { attributeLabel } from "../../attribute-filter/ui/attribute-meta";
import { axisLabels, bucketTitle } from "../../histogram/volume-histogram";
import {
  type GroupByKey,
  MAX_GROUP_BY,
  type MetricAggregation,
  type MetricKind,
  type MetricViewMode,
} from "../data/schemas";
import {
  type BucketMergeNote,
  isHistogramKind,
  type MetricMetadata,
  type MetricExemplar,
  type MetricSeriesResult,
} from "../data/types";
import { ExemplarCard, type ExemplarLinkRenderProps } from "./exemplar-card";
import { formatCount, formatMetricValue, temporalityLabel, unitName } from "./format";
import { MetricHeatmap } from "./metric-heatmap";
import { MetricKindBadge, MetricName, QueryTag } from "./metric-name";
import { MetricPicker, type MetricPickerProps } from "./metric-picker";

const NO_EXCLUDED_KEYS: ReadonlySet<string> = new Set();

export function MetricView({
  metric,
  kind,
  entry,
  entryStale = false,
  aggregations,
  aggregation,
  groupBy,
  result,
  exemplars,
  isPending,
  stale = false,
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
  linesGroupBy,
  metricPicker,
  queryRows,
  queryMetrics,
  onAddQuery,
  allHidden = false,
}: {
  metric: string;
  kind: MetricKind | null;
  entry: MetricMetadata | undefined;
  /** `kind` and `entry` are the last metric's, kept while another's load. */
  entryStale?: boolean;
  aggregations: MetricAggregation[];
  aggregation: MetricAggregation | null;
  groupBy: GroupByKey[];
  result: MetricSeriesResult | undefined;
  /** Drawn on the chart when their values share its axis. */
  exemplars: MetricExemplar[] | undefined;
  isPending: boolean;
  /** The chart on screen is from before the last change, and its data is reloading. */
  stale?: boolean;
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
  /** The group-by the lines were drawn with, which `groupBy` leads while they reload. */
  linesGroupBy: GroupByKey[];
  /** The metric name opens it, to switch the chart to another metric. */
  metricPicker: MetricPickerProps;
  /** With several queries, one row each in place of the single query's controls. */
  queryRows?: ReactNode;
  /** The metrics the query rows chart, named in the page's heading. */
  queryMetrics?: string[];
  /** Unset once the chart has as many queries as it can take. */
  onAddQuery?: () => void;
  /** Several queries, every one of them hidden. */
  allHidden?: boolean;
}) {
  const unit = entry?.unit ?? "";
  const heldClass = staleClass(entryStale);
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
  // A range that ends before it starts has no intervals, so no resolution.
  const resolution =
    result && result.buckets.length > 0 ? (
      <MetaItem label="Resolution" className={staleClass(stale)}>
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
          <h1 className="sr-only">{[...new Set(queryMetrics)].join(", ")}</h1>
          {back}
          <dl className={cn(META_ROW, "ml-auto")}>{resolution}</dl>
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
            {kind ? (
              <span className={heldClass}>
                <MetricKindBadge kind={kind} />
              </span>
            ) : null}
          </div>
          {entry?.description ? (
            <p className={cn("text-muted-foreground text-sm", heldClass)}>{entry.description}</p>
          ) : null}
          <dl className={cn(META_ROW, "flex-wrap")}>
            {entry?.unit ? (
              <MetaItem label="Unit" className={heldClass}>
                <span title={`UCUM unit: ${entry.unit}`}>{unitName(entry.unit)}</span>
              </MetaItem>
            ) : null}
            {temporality ? (
              <MetaItem label="Temporality" className={heldClass}>
                {temporality}
              </MetaItem>
            ) : null}
            {resolution}
          </dl>
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
            <>
              <span className="text-muted-foreground text-xs">Show</span>
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
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {view === "lines" ? <AddMetricButton onAdd={onAddQuery} /> : null}
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

      <div aria-busy={stale} className={cn("flex flex-1 flex-col", staleClass(stale))}>
        <SeriesPanel
          lines={lines}
          multi={Boolean(queryRows)}
          allHidden={allHidden}
          heatmapUnit={unit}
          view={view}
          aggregation={aggregation}
          groupBy={linesGroupBy}
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
    </div>
  );
}

// Kept in place while empty, as tall as a MetaItem, so the header doesn't
// jump when the chart's resolution comes and goes.
const META_ROW = "flex min-h-5.5 items-center gap-1.5 text-xs";

/**
 * Dims what shows data from before the last change while it reloads. Like
 * Button's loading state, it waits 150ms, so a quick reload shows nothing:
 * a transition that has not started is simply cancelled. Fresh data shows
 * at full strength at once.
 */
function staleClass(stale: boolean) {
  return cn(
    "transition-opacity duration-0",
    stale && "opacity-50 delay-150 duration-150 motion-reduce:duration-0",
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
}: {
  aggregations: MetricAggregation[];
  aggregation: MetricAggregation | null;
  groupBy: GroupByKey[];
  attributeRepo: AttributeRepositoryLike;
  attributeDomain: string;
  timeRange: { from: string; to: string };
  onAggregationChange: (aggregation: MetricAggregation) => void;
  onGroupByChange: (groupBy: GroupByKey[]) => void;
}) {
  // Removing a key, or adding the last one allowed, unmounts the control that
  // did it, so focus moves to the remove button now in its place, else the
  // picker, else the last remove button, once the host renders the new keys.
  const byLabel = useRef<HTMLSpanElement>(null);
  const pickerId = useId();
  const focusAfter = useRef<{ index: number; keys: number } | null>(null);
  useEffect(() => {
    const pending = focusAfter.current;
    if (!pending || pending.keys !== groupBy.length) return;
    focusAfter.current = null;
    const removes =
      byLabel.current?.parentElement?.querySelectorAll<HTMLElement>("[data-group-by-remove]") ?? [];
    (
      removes[pending.index] ??
      document.getElementById(pickerId) ??
      removes[removes.length - 1]
    )?.focus();
  });

  return (
    <>
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
      <span ref={byLabel} className="text-muted-foreground ml-2 text-xs">
        by
      </span>
      {groupBy.map((key, index) => (
        <Badge key={`${key.source}:${key.key}`} variant="secondary" className="h-6 gap-1 pr-1">
          <span className="font-mono">{key.key}</span>
          {sourceOf(key, groupBy) ? (
            <span className="text-muted-foreground">{sourceOf(key, groupBy)}</span>
          ) : null}
          <button
            type="button"
            data-group-by-remove
            aria-label={["Stop grouping by", key.key, sourceOf(key, groupBy)]
              .filter(Boolean)
              .join(" ")}
            className="hover:text-foreground text-muted-foreground cursor-pointer rounded-sm"
            onClick={() => {
              focusAfter.current = { index, keys: groupBy.length - 1 };
              onGroupByChange(groupBy.filter((k) => k.source !== key.source || k.key !== key.key));
            }}
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
          triggerName={groupBy.length === 0 ? undefined : "Add group-by key"}
          triggerClassName="h-6"
          triggerId={pickerId}
          // The picker goes away with the last key it can add, and the
          // focus move above takes over, so the menu leaves focus alone.
          finalFocus={() => focusAfter.current === null}
          onSelect={(key) => {
            if (groupBy.length + 1 === MAX_GROUP_BY) {
              focusAfter.current = { index: MAX_GROUP_BY, keys: MAX_GROUP_BY };
            }
            onGroupByChange([...groupBy, key]);
          }}
        />
      ) : null}
    </>
  );
}

function SeriesPanel({
  lines,
  multi,
  allHidden,
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
  lines: ChartLine[] | undefined;
  /** Several queries: no exemplars, notes or group-by heading of one query. */
  multi: boolean;
  allHidden: boolean;
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
  // The exemplar picked and where its card opens. Its values come from the
  // chart as drawn now, so a new aggregation or group-by updates the card.
  const [picked, setPicked] = useState<{
    exemplar: Pick<MetricExemplar, "traceId" | "spanId" | "time">;
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
    const series = lines.map((line): LineSeries => ({
      id: line.id,
      label: line.label,
      query: line.query,
      name: line.name,
      color: SERIES_COLORS[line.color % SERIES_COLORS.length] ?? ACCENT_COLOR,
      kind: "line",
      values: line.values,
      rightAxis: scales.length > 1 && scaleKey(line) === scales[1],
      stats: stats(line.values),
      format: formatOf(line),
    }));
    return {
      labels: axisLabels(buckets),
      titles: buckets.map(bucketTitle),
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
        const series = seriesOf.get(lineId(exemplar.labels));
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
  }, [chart, exemplars]);
  const pickedMarker = picked
    ? markers.find(
        ({ exemplar: e }) =>
          e.traceId === picked.exemplar.traceId &&
          e.spanId === picked.exemplar.spanId &&
          e.time === picked.exemplar.time,
      )
    : undefined;
  // Back, Forward or a new range can chart other exemplars; the card closes
  // then rather than describe what's gone.
  if (picked && !pickedMarker) setPicked(null);

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
  if (allHidden) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>All queries are hidden</EmptyTitle>
          <EmptyDescription>Show a query to chart it.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  // A rate can leave out a short last bucket that the heatmap still counts.
  const heatmapHasData =
    view === "heatmap" && Boolean(result?.heatmap?.counts.some((row) => row.some((c) => c > 0)));
  if (!chart || (chart.series.length === 0 && !heatmapHasData)) {
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

  // Switched to the heatmap, the lines stay until the heatmap's own request returns.
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

  // Each query's lines are its top series: say what was left out.
  const linesOf = new Map<string, { query: LineQuery; shown: number }>();
  for (const { query } of chart.series) {
    if (query) linesOf.set(query.id, { query, shown: (linesOf.get(query.id)?.shown ?? 0) + 1 });
  }
  const cuts = multi
    ? [...linesOf.values()].flatMap(({ query, shown }) =>
        query.totalSeries > shown
          ? [{ prefix: `Query ${query.id}: the`, shown, total: query.totalSeries }]
          : [],
      )
    : (result?.totalSeries ?? 0) > chart.series.length
      ? [{ prefix: "The", shown: chart.series.length, total: result?.totalSeries ?? 0 }]
      : [];
  const groupHeading =
    !multi && groupBy.length > 0
      ? groupBy.map((k) => groupKeyLabel(k, groupBy)).join(" · ")
      : "Series";

  return (
    <>
      <SeriesLines
        labels={chart.labels}
        titles={chart.titles}
        series={chart.series}
        axes={chart.axes}
        sparseLabels
        smooth={false}
        markers={markers}
        onMarkerClick={(marker, at) => {
          const hit = markers.find((m) => m.id === marker.id);
          if (hit) setPicked({ exemplar: hit.exemplar, at });
        }}
        className="h-[260px] w-full"
        onSelect={(from, to) => {
          const start = chart.buckets[from];
          const end = chart.buckets[to];
          if (start && end) onRangeSelect(new Date(start.timestamp), new Date(end.endTimestamp));
        }}
        groupHeading={groupHeading}
      />
      {picked && pickedMarker ? (
        <ExemplarCard
          exemplar={pickedMarker.exemplar}
          at={picked.at}
          value={format(pickedMarker.exemplar.value)}
          charted={
            pickedMarker.lineValue !== null && aggregation
              ? { label: aggregation, value: format(pickedMarker.lineValue) }
              : null
          }
          groups={groupBy.map((g, i) => ({
            id: `${g.source}:${g.key}`,
            label: groupKeyLabel(g, groupBy),
            value: pickedMarker.exemplar.labels[i] ?? "",
          }))}
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
      {cuts.length > 0 ? (
        <p className="text-muted-foreground px-4 py-2 text-xs">
          {cuts
            .map(
              (cut) =>
                `${cut.prefix} ${cut.shown} series with the highest values of ${formatCount(cut.total)}.`,
            )
            .join(" ")}{" "}
          Filter or group by fewer attributes to see the rest.
        </p>
      ) : null}
    </>
  );
}

/**
 * The chart and its table of series. Hovering a row brings its line forward.
 * The hover lives here so it goes when the table does: a row removed while
 * hovered gets no pointer leave.
 */
function SeriesLines({
  series,
  groupHeading,
  ...chartProps
}: Omit<ComponentProps<typeof SeriesChart>, "series" | "focusedSeries"> & {
  series: LineSeries[];
  groupHeading: string;
}) {
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);
  return (
    <>
      <div className="px-4 pt-3 pb-1">
        <SeriesChart {...chartProps} series={series} focusedSeries={hoveredSeries} />
      </div>
      {/* The values take the width they need and the series column the rest,
          truncating a long name rather than pushing the values off-screen. */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th
              className="w-full max-w-0 truncate px-4 py-1.5 text-left font-medium"
              title={groupHeading}
            >
              {groupHeading}
            </th>
            <th className="w-px px-2 py-1.5 text-right font-medium">last</th>
            <th className={`w-px px-2 py-1.5 text-right font-medium ${AVG_COLUMN}`}>avg</th>
            <th className="w-px px-4 py-1.5 text-right font-medium">max</th>
          </tr>
        </thead>
        {/* One row group per query, so each query's heading heads only its own rows. */}
        {seriesGroups(series).map(({ query, series }) => (
          <tbody key={query?.id ?? "series"}>
            {query ? (
              <tr className="bg-muted/30 border-b">
                {/* No wider than the table, so a long metric name truncates
                    rather than widening every column. */}
                <th
                  scope="rowgroup"
                  colSpan={4}
                  className="max-w-0 px-4 py-1.5 text-left font-normal"
                >
                  <span className="flex min-w-0 items-center gap-2 text-xs">
                    <QueryTag id={query.id} metric={query.metric} />
                    {query.aggregation ? (
                      <span className="text-muted-foreground shrink-0">{query.aggregation}</span>
                    ) : null}
                  </span>
                </th>
              </tr>
            ) : null}
            {series.map((s) => (
              <tr
                key={s.id}
                className="hover:bg-muted/50 border-b"
                onPointerEnter={() => setHoveredSeries(s.id)}
                onPointerLeave={() => setHoveredSeries(null)}
              >
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
                <StatCell value={s.stats.avg} format={s.format} className={AVG_COLUMN} />
                <StatCell value={s.stats.max} format={s.format} className="pr-4" />
              </tr>
            ))}
          </tbody>
        ))}
      </table>
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

function MetaItem({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-stretch overflow-hidden rounded-md border", className)}>
      <dt className="bg-muted text-muted-foreground border-r px-1.5 py-0.5">{label}</dt>
      <dd className="px-1.5 py-0.5">{children}</dd>
    </div>
  );
}

// On a phone, last and max leave the series names room.
const AVG_COLUMN = "hidden sm:table-cell";

/** Consecutive series of the same query, in chart order. */
function seriesGroups<S extends { query?: { id: string } }>(series: readonly S[]) {
  const groups: { query: S["query"]; series: S[] }[] = [];
  for (const s of series) {
    const last = groups.at(-1);
    if (last && last.query?.id === s.query?.id) last.series.push(s);
    else groups.push({ query: s.query, series: [s] });
  }
  return groups;
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
    <td
      className={`w-px px-2 py-1.5 text-right text-xs whitespace-nowrap tabular-nums ${className}`}
    >
      {/* A minimum width, so a value growing a digit on refresh doesn't shift the columns. */}
      <span className="inline-block min-w-16">{value === null ? "—" : format(value)}</span>
    </td>
  );
}

type SeriesStats = { last: number | null; avg: number | null; max: number | null };

type LineSeries = ChartSeries & {
  query?: LineQuery;
  name: string;
  stats: SeriesStats;
  format: (v: number) => string;
};

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
type LineQuery = {
  id: string;
  metric: string;
  aggregation: MetricAggregation | null;
  /** Its series before the cut to the top ones. */
  totalSeries: number;
};

export type ChartLine = {
  id: string;
  /** The line's name, with its query's letter first when there are several. */
  label: string;
  /** With several queries, the line's query, which heads its group in the series list. */
  query?: LineQuery;
  /** The series' group-by values, or the metric when it has none. */
  name: string;
  values: (number | null)[];
  /** The values' unit; a histogram's rate has none. */
  unit: string;
  aggregation: MetricAggregation | null;
  /** Its place in the palette, counted with hidden queries' lines, so hiding one recolors nothing. */
  color: number;
};

// Grouping by a key from both the metric's and the resource's attributes
// names each by its source, so the two read apart.
function sourceOf(key: GroupByKey, groupBy: GroupByKey[]): string | null {
  return groupBy.some((k) => k.key === key.key && k.source !== key.source)
    ? `(${key.source})`
    : null;
}

function groupKeyLabel(key: GroupByKey, groupBy: GroupByKey[]): string {
  return [attributeLabel(key.key) ?? key.key, sourceOf(key, groupBy)].filter(Boolean).join(" ");
}

// Lines that format the same way share an axis; a rate adds "/s".
function scaleKey(line: ChartLine): string {
  return `${line.unit}|${line.aggregation === "rate" ? "rate" : ""}`;
}

/** A line's ID, from its query and its group's labels, so no two groups share one. */
export function lineId(labels: string[], queryId?: string): string {
  return JSON.stringify(queryId ? [queryId, ...labels] : labels);
}

export function seriesLabel(labels: string[], metric: string): string {
  if (labels.length === 0) return metric;
  return labels.map((v) => (v === "" ? "(none)" : v)).join(" · ");
}

/** Adds a query to the chart, a copy of the last one. */
export function AddMetricButton({ onAdd }: { onAdd?: () => void }): ReactNode {
  if (!onAdd) return null;
  return (
    <Button variant="ghost" size="sm" aria-label="Add metric query" onClick={onAdd}>
      <Plus />
      Metric
    </Button>
  );
}
