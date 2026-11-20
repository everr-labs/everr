import { FilterSearchBar } from "@everr/ui/components/filter-search-bar";
import { Label } from "@everr/ui/components/label";
import { Shapes } from "lucide-react";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { withEnvironment } from "../../filters/environment";
import { countPersistentFilters } from "../../filters/ui/explore-global-filters";
import { ExploreFilterPill } from "../../filters/ui/explore-filter-pill";
import { ExploreFilterRail } from "../../filters/ui/explore-filter-rail";
import { NoResults } from "../../filters/ui/no-results";
import {
  metricCatalogOptions,
  metricKindOptions,
  metricMetadataOptions,
  metricNamesOptions,
  metricExemplarsOptions,
  metricExportIntervalOptions,
  metricSeriesOptions,
  metricSummaryQuantilesOptions,
} from "../data/options";
import type { MetricsRepositoryLike } from "../data/repository";
import {
  type GroupByKey,
  type MetricAggregation,
  type MetricChartQuery,
  MetricChartQuerySchema,
  type MetricsSearch,
  type MetricType,
  type MetricViewMode,
  type MetricKind,
  MetricKindSchema,
} from "../data/schemas";
import {
  aggregationsFor,
  defaultAggregation,
  isHistogramKind,
  metricKind,
  summaryAggregations,
  valueUnit,
} from "../data/types";
import { QueryRow } from "./chart-queries";
import { METRIC_KIND_SHORT_LABELS } from "./format";
import type { ExemplarLinkRenderProps } from "./exemplar-card";
import { MetricCatalog, type MetricLinkRenderProps } from "./metric-catalog";
import { AddMetricButton, type ChartLine, MetricView, seriesLabel } from "./metric-view";
import type { MetricPickerProps } from "./metric-picker";
import { useDistinctQueries } from "./use-distinct-queries";
import { useLastLoaded } from "./use-last-loaded";

export type { ExemplarLinkRenderProps, MetricLinkRenderProps };

export type MetricsExplorerSearch = {
  q: string;
  types: MetricKind[];
  metric?: string;
  metricType?: MetricType;
  agg?: MetricAggregation;
  view?: MetricViewMode;
  by: GroupByKey[];
  attributes: AttributeFilter[];
  queries: MetricChartQuery[];
  hidden: MetricsSearch["hidden"];
};

export type MetricsExplorerProps = {
  repo: MetricsRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  search: MetricsExplorerSearch;
  service: string[];
  environment: string[];
  // The top zone of the rail: Service and Environment, shared across Explore.
  persistentFilters?: ReactNode;
  onSearchChange: (patch: Partial<MetricsExplorerSearch>) => void;
  onTimeRangeSelect: (from: Date, to: Date) => void;
  renderMetricLink: (props: MetricLinkRenderProps) => ReactNode;
  renderCatalogLink: (props: { className: string; children: ReactNode }) => ReactNode;
  renderTraceLink: (props: ExemplarLinkRenderProps) => ReactNode;
  renderLogsLink: (props: ExemplarLinkRenderProps) => ReactNode;
};

// Exemplars share the chart's axis only when it plots the metric's own
// values: a histogram's percentiles or average, a gauge's level. A rate or a
// sum across series is on another scale.
const EXEMPLAR_AGGREGATIONS = new Set<MetricAggregation>([
  "p50",
  "p95",
  "p99",
  "avg",
  "min",
  "max",
]);

const isMetricKind = (value: string): value is MetricKind =>
  MetricKindSchema.safeParse(value).success;

const METRIC_ATTRIBUTE_SOURCES_UI = ["metric", "resource"] as const;

// Service and Environment have their own controls at the top of the rail.
const METRIC_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:deployment.environment.name",
]);

/** Leaving a metric drops what only made sense for it. */
export const CLEAR_METRIC: Partial<MetricsExplorerSearch> = {
  metric: undefined,
  metricType: undefined,
  agg: undefined,
  view: undefined,
  by: [],
  attributes: [],
  queries: [],
  hidden: [],
};

export function MetricsExplorer(props: MetricsExplorerProps) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          {props.search.metric ? (
            <MetricPage {...props} metric={props.search.metric} />
          ) : (
            <CatalogPage {...props} />
          )}
        </div>
      </section>
    </div>
  );
}

function CatalogPage({
  repo,
  timeRange,
  refresh,
  search,
  service,
  environment,
  persistentFilters,
  onSearchChange,
  renderMetricLink,
}: MetricsExplorerProps) {
  const query = useQuery(
    metricCatalogOptions(
      repo,
      {
        timeRange,
        q: search.q,
        kinds: search.types,
        service,
        attributes: withEnvironment([], environment),
      },
      refresh,
    ),
  );
  const pageFilterCount = (search.q ? 1 : 0) + (search.types.length > 0 ? 1 : 0);
  const persistentFilterCount = countPersistentFilters(service, environment);
  const clear = () => onSearchChange({ q: "", types: [] });

  return (
    <>
      <ExploreFilterRail
        label="Metric filters"
        persistentFilters={persistentFilters}
        persistentFilterCount={persistentFilterCount}
        pageFilterCount={pageFilterCount}
        onClear={clear}
      >
        <FilterSearchBar
          id="metrics-search"
          label="Search"
          value={search.q}
          onChange={(q) => onSearchChange({ q })}
          placeholder="Filter by metric name"
        />
        <div className="flex flex-col gap-1">
          <Label id="metrics-type-label" className="text-muted-foreground text-xs">
            Type
          </Label>
          <ExploreFilterPill
            label="Type"
            labelId="metrics-type-label"
            icon={Shapes}
            accent={false}
            values={search.types}
            onChange={(next) => onSearchChange({ types: next.filter(isMetricKind) })}
            options={metricKindOptions(
              repo,
              { timeRange, service, attributes: withEnvironment([], environment) },
              search.types,
            )}
            formatValue={(value) => (isMetricKind(value) ? METRIC_KIND_SHORT_LABELS[value] : value)}
            placeholder="All types"
            searchPlaceholder="Search types..."
            className="w-full max-w-none"
          />
        </div>
      </ExploreFilterRail>
      <main className="flex min-h-0 min-w-0 flex-col">
        <MetricCatalog
          rows={query.data ?? []}
          isPending={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          renderMetricLink={renderMetricLink}
          empty={
            <NoResults
              noun="metrics"
              timeRange={timeRange}
              filterCount={persistentFilterCount + pageFilterCount}
              onClearFilters={pageFilterCount > 0 ? clear : undefined}
            />
          }
        />
      </main>
    </>
  );
}

type QueryId = MetricsSearch["hidden"][number];

type QuerySpec = {
  id: QueryId;
  metric: string;
  type: MetricType | undefined;
  agg?: MetricAggregation;
  by: GroupByKey[];
  attributes: AttributeFilter[];
};

/** The chart's queries in order: A from the page's own fields, then `queries`. */
function toSpecs(search: MetricsExplorerSearch, metric: string): QuerySpec[] {
  const queryA: QuerySpec = {
    id: "A",
    metric,
    type: search.metricType,
    agg: search.agg,
    by: search.by,
    attributes: search.attributes,
  };
  return [
    queryA,
    ...search.queries.map((q) => ({ ...q, by: q.by ?? [], attributes: q.attributes ?? [] })),
  ];
}

/**
 * Writes queries back to the search: the first is A, in the page's own
 * fields, so a single-metric link stays `?metric=`; the rest keep their letters.
 */
function fromSpecs([first, ...rest]: QuerySpec[]): Partial<MetricsExplorerSearch> {
  if (!first) return {};
  return {
    metric: first.metric,
    metricType: first.type,
    agg: first.agg,
    by: first.by,
    attributes: first.attributes,
    queries: rest.flatMap(({ id, type, metric, agg, by, attributes }) =>
      id !== "A" && type
        ? [
            {
              id,
              type,
              metric,
              agg,
              ...(by.length > 0 ? { by } : {}),
              ...(attributes.length > 0 ? { attributes } : {}),
            },
          ]
        : [],
    ),
  };
}

const QUERY_IDS = MetricChartQuerySchema.shape.id.options;

function MetricPage({
  repo,
  timeRange,
  refresh,
  search,
  service,
  environment,
  persistentFilters,
  onSearchChange,
  onTimeRangeSelect,
  renderCatalogLink,
  renderTraceLink,
  renderLogsLink,
  metric,
}: MetricsExplorerProps & { metric: string }) {
  const environmentOnly = withEnvironment([], environment);
  const specs = toSpecs(search, metric);
  const multi = specs.length > 1;
  const hidden = new Set<string>(search.hidden);

  // Every metric in range, for the metric switcher: names and types only,
  // as the full catalog's counts take seconds over long ranges.
  const allMetrics = metricNamesOptions(repo, { timeRange, service, attributes: environmentOnly });
  // Each query's metadata: unit, temporality, and A's type when the link
  // didn't name it.
  const metadataQueries = useDistinctQueries(
    specs.map((q) =>
      metricMetadataOptions(repo, {
        timeRange,
        metric: q.metric,
        type: q.type,
        service,
        attributes: environmentOnly,
      }),
    ),
  );
  const metadataData = useLastLoaded(
    metadataQueries.map((query) => query.data),
    specs.map((q) => `${q.metric}\u0000${q.type ?? ""}`),
  );
  const described = specs.map((spec, i) => {
    const metadata = metadataQueries[i];
    const loadedMetadata = metadataData[i];
    const entry = loadedMetadata ?? undefined;
    const type = spec.type ?? entry?.type;
    // A sum's kind needs its metadata; until then, offer nothing rather than
    // guess between a counter's rate and an UpDownCounter's sum.
    const kind =
      type && (type !== "sum" || entry) ? metricKind(type, entry?.isMonotonic ?? false) : null;
    return {
      ...spec,
      type,
      entry,
      kind,
      metadata,
      metadataPending: loadedMetadata === undefined && Boolean(metadata?.isPending),
    };
  });

  const view: MetricViewMode =
    !multi && isHistogramKind(described[0]?.kind ?? null) ? (search.view ?? "lines") : "lines";

  const quantileQueries = useDistinctQueries(
    described.map((q) => ({
      ...metricSummaryQuantilesOptions(repo, { timeRange, metric: q.metric }),
      enabled: q.kind === "summary",
    })),
  );
  const quantileData = useLastLoaded(
    quantileQueries.map((query) => query.data),
    described.map((q) => q.metric),
  );
  const aggregated = described.map((q, i) => {
    const quantiles = quantileQueries[i];
    // A summary offers only the quantiles it reports, so its aggregation waits
    // for them instead of defaulting to one that may not exist.
    const reported = quantileData[i];
    const aggregations = !q.kind
      ? []
      : q.kind !== "summary"
        ? aggregationsFor(q.kind)
        : reported
          ? summaryAggregations(reported)
          : [];
    const aggregation =
      q.agg && aggregations.includes(q.agg)
        ? q.agg
        : q.kind && aggregations.length > 0
          ? defaultAggregation(q.kind, aggregations)
          : null;
    return {
      ...q,
      quantiles,
      quantilesPending:
        q.kind === "summary" && reported === undefined && Boolean(quantiles?.isPending),
      aggregations,
      aggregation,
      scopedAttributes: withEnvironment(q.attributes, environment),
    };
  });

  // The chart is never finer than the slowest query's export interval, so
  // every query, and the exemplars, share one step and line up.
  const intervalQueries = useDistinctQueries(
    aggregated.map((q) => ({
      ...metricExportIntervalOptions(repo, {
        timeRange,
        metric: q.metric,
        type: q.type ?? "gauge",
        service,
        // Filters narrow which series report, not how often they export.
        attributes: environmentOnly,
      }),
      enabled: Boolean(q.type),
    })),
  );
  const intervalsReady = aggregated.every((q, i) => !q.type || intervalQueries[i]?.isSuccess);
  const minStep = Math.max(0, ...intervalQueries.map((query) => query.data ?? 0)) || undefined;
  // One request for every query, so changing one refetches them all and
  // their buckets always come from the same range.
  const seriesQuery = useQuery({
    ...metricSeriesOptions(
      repo,
      aggregated.map((q) =>
        q.type && q.aggregation
          ? {
              timeRange,
              metric: q.metric,
              type: q.type,
              aggregation: q.aggregation,
              groupBy: q.by,
              service,
              attributes: q.scopedAttributes,
              minStep,
              heatmap: view === "heatmap",
            }
          : null,
      ),
      refresh,
    ),
    // Once every query knows what it fetches, so none is fetched twice.
    enabled:
      intervalsReady &&
      aggregated.some((q) => q.type && q.aggregation) &&
      !aggregated.some((q) => q.metadataPending || q.quantilesPending),
  });
  const queries = aggregated.map((q, i) => ({
    ...q,
    interval: intervalQueries[i],
    result: seriesQuery.data?.[i] ?? undefined,
  }));
  const [queryA] = queries;
  if (!queryA) throw new Error("A chart always has query A");

  const showExemplars =
    !multi &&
    // Summaries carry no exemplars. A sum's exemplars are the amounts added,
    // not its running total or level, so they're never on the line's scale.
    queryA.kind !== "summary" &&
    queryA.type !== "sum" &&
    queryA.aggregation !== null &&
    EXEMPLAR_AGGREGATIONS.has(queryA.aggregation) &&
    view === "lines";
  const exemplarsQuery = useQuery({
    ...metricExemplarsOptions(
      repo,
      {
        timeRange,
        metric,
        type: queryA.type ?? "gauge",
        groupBy: queryA.by,
        service,
        attributes: queryA.scopedAttributes,
        minStep,
      },
      refresh,
    ),
    enabled: showExemplars && intervalsReady,
  });

  // Every query shares one step and grid, so any result frames the chart.
  // Lines come only from current results, so they never mix two ranges.
  const frame = queryA.result ?? queries.find((q) => q.result)?.result;
  // A query is settled once it has data, or once nothing left to load can
  // give it an aggregation, such as a counter with no points in range.
  const allLoaded = queries.every(
    (q) => q.result !== undefined || (!q.aggregation && !q.metadataPending && !q.quantilesPending),
  );

  // What the lines are drawn from besides the series data, whose arrays stay
  // the same across refetches that return the same values.
  const lineKey = JSON.stringify([
    queries.map((q) => [q.id, q.metric, q.kind, q.aggregation, q.entry?.unit]),
    search.hidden,
  ]);
  const lines = useMemo(() => {
    if (!allLoaded) return undefined;
    // Settled with nothing to draw: an empty chart, which replaces the last one.
    if (!frame) return [];
    const out: ChartLine[] = [];
    let color = 0;
    for (const q of queries) {
      const result = q.result;
      if (!result) continue;
      if (multi && hidden.has(q.id)) {
        color += result.series.length;
        continue;
      }
      const unit = valueUnit(q.kind, q.aggregation, q.entry?.unit ?? "");
      const query = {
        id: q.id,
        metric: q.metric,
        aggregation: q.aggregation,
        totalSeries: result.totalSeries,
      };
      for (const s of result.series) {
        // Under its query's heading, a series grouped by nothing needs no name.
        const name =
          multi && s.labels.length === 0 ? "all series" : seriesLabel(s.labels, q.metric);
        out.push({
          id: multi ? `${q.id}\u0000${s.labels.join("\u0000")}` : s.labels.join("\u0000") || metric,
          label: multi ? `${q.id} · ${seriesLabel(s.labels, q.metric)}` : name,
          name,
          ...(multi ? { query } : {}),
          values: s.values,
          unit,
          aggregation: q.aggregation,
          color: color++,
        });
      }
    }
    return out;
    // Everything else read above is captured by lineKey.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesQuery.data, lineKey, allLoaded]);
  // The last chart drawn stays while the same metrics reload with another
  // range, filter, group-by or aggregation. Each line carries its own unit and
  // aggregation, so it reads right until it's replaced. Another metric starts over.
  const chart = useMemo(() => (lines ? { lines, frame } : undefined), [lines, frame]);
  const chartKey = queries.map((q) => [q.id, q.metric, q.type].join("\u0000")).join("\u0001");
  const [shown] = useLastLoaded([chart], [chartKey]);
  const current = shown === chart;

  const attributeRepoFor = (q: Pick<QuerySpec, "metric" | "type">): AttributeRepositoryLike => ({
    attributeKeys: ({ timeRange }) =>
      q.type
        ? repo.attributeKeys({ timeRange, metric: q.metric, type: q.type })
        : Promise.resolve([]),
    attributeValues: (input) =>
      q.type
        ? repo.attributeValues({ ...input, metric: q.metric, type: q.type })
        : Promise.resolve([]),
  });

  // The rail's Attributes edit one query: A unless another row is picked.
  const [selectedId, setSelectedId] = useState<QueryId>("A");
  const selected = queries.find((q) => q.id === selectedId) ?? queryA;
  const selectedRepo = useMemo(
    () => attributeRepoFor(selected),
    // A query's attribute lists depend only on its metric.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [repo, selected.metric, selected.type],
  );
  const attributeRepo = useMemo(
    () => attributeRepoFor(queryA),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [repo, metric, queryA.type],
  );

  // The search with one query changed, every query written back.
  const withQuery = (id: QueryId, patch: Partial<Omit<QuerySpec, "id">>) =>
    fromSpecs(queries.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  // Adding or removing a query unmounts the button that did it, so focus moves
  // to the metric of the query added, or of the row that took the removed
  // one's place, once the page renders that many queries: the host applies
  // the new search after renders that still show the old rows.
  const pickerIdPrefix = useId();
  const focusPickerOf = useRef<{ id: QueryId; queries: number } | null>(null);
  useEffect(() => {
    const pending = focusPickerOf.current;
    if (!pending || pending.queries !== queries.length) return;
    focusPickerOf.current = null;
    document.getElementById(`${pickerIdPrefix}-${pending.id}`)?.focus();
  });

  const freeQueryId = QUERY_IDS.find((id) => !queries.some((q) => q.id === id));
  const addQuery = freeQueryId
    ? () => {
        // A copy of the last query, ready to change: the usual next step is
        // the same metric with another filter, or a sibling metric.
        const last = queries[queries.length - 1];
        if (!last?.type) return;
        onSearchChange({
          ...fromSpecs([
            ...queries,
            // The aggregation only when picked, so the copy follows the default.
            { ...last, id: freeQueryId },
          ]),
          view: undefined,
          // A letter left from a removed query would hide the new one.
          hidden: search.hidden.filter((h) => queries.some((q) => q.id === h)),
        });
        setSelectedId(freeQueryId);
        focusPickerOf.current = { id: freeQueryId, queries: queries.length + 1 };
      }
    : undefined;

  const removeQuery = (id: QueryId) => {
    const remaining = queries.filter((q) => q.id !== id);
    // The first query left is written back as A, which renames it when A goes.
    const renamed = remaining[0]?.id;
    onSearchChange({
      ...fromSpecs(remaining),
      view: undefined,
      // Back to one query, the page has no hide toggle, so nothing stays hidden.
      hidden:
        remaining.length === 1
          ? []
          : search.hidden.flatMap((h) => (h === id ? [] : [h === renamed ? "A" : h])),
    });
    if (selectedId === id || selectedId === renamed) setSelectedId("A");
    // The row that takes the removed one's place, or the last row.
    const index = Math.min(
      queries.findIndex((q) => q.id === id),
      remaining.length - 1,
    );
    focusPickerOf.current = {
      id: index === 0 ? "A" : (remaining[index]?.id ?? "A"),
      queries: remaining.length,
    };
  };

  // Switching a query's metric drops what only made sense for the old one.
  const pickerFor = (q: QuerySpec): MetricPickerProps => ({
    triggerId: `${pickerIdPrefix}-${q.id}`,
    metrics: allMetrics,
    value: { name: q.metric, type: q.type },
    onChange: ({ name, type }) =>
      onSearchChange({
        ...withQuery(q.id, { metric: name, type, agg: undefined, by: [], attributes: [] }),
        view: undefined,
      }),
  });

  const queryRows = multi ? (
    <>
      {queries.map((q, i) => (
        <QueryRow
          key={q.id}
          id={q.id}
          metric={q.metric}
          kind={q.kind}
          entry={q.entry}
          picker={pickerFor(q)}
          selected={selected.id === q.id}
          filterCount={q.attributes.length}
          aggregations={q.aggregations}
          aggregation={q.aggregation}
          groupBy={q.by}
          attributeRepo={i === 0 ? attributeRepo : attributeRepoFor(q)}
          attributeDomain={`metrics:${q.type ?? ""}:${q.metric}`}
          timeRange={timeRange}
          onSelect={() => setSelectedId(q.id)}
          hidden={hidden.has(q.id)}
          onToggleHidden={() =>
            onSearchChange({
              hidden: hidden.has(q.id)
                ? search.hidden.filter((h) => h !== q.id)
                : [...search.hidden, q.id],
            })
          }
          onRemove={() => removeQuery(q.id)}
          onAggregationChange={(agg) => onSearchChange(withQuery(q.id, { agg }))}
          onGroupByChange={(by) => onSearchChange(withQuery(q.id, { by }))}
        />
      ))}
      {/* Right-aligned, where the single-query toolbar has it, so it only moves
          down. Gone with the fourth query, as there's nothing left to add. */}
      {addQuery ? (
        <div className="flex justify-end px-4 py-1.5">
          <AddMetricButton onAdd={addQuery} />
        </div>
      ) : null}
    </>
  ) : undefined;

  const error =
    seriesQuery.error ??
    queries.find((q) => q.interval?.error)?.interval?.error ??
    queries.find((q) => q.metadata?.error)?.metadata?.error ??
    queries.find((q) => q.quantiles?.error)?.quantiles?.error ??
    null;

  return (
    <>
      <ExploreFilterRail
        label="Metric filters"
        persistentFilters={persistentFilters}
        persistentFilterCount={countPersistentFilters(service, environment)}
        pageFilterCount={selected.attributes.length}
        onClear={() => onSearchChange(withQuery(selected.id, { attributes: [] }))}
      >
        <AttributeFilterSection
          key={selected.id}
          heading={
            multi ? (
              // Which query the filters below apply to; the query rows pick it.
              <span className="text-muted-foreground text-xs" title={selected.metric}>
                Attributes of query{" "}
                <span className="text-foreground font-mono font-medium">{selected.id}</span>
              </span>
            ) : undefined
          }
          repo={selectedRepo}
          domain={`metrics:${selected.type ?? ""}:${selected.metric}`}
          timeRange={timeRange}
          attributes={selected.attributes}
          promotedAttributes={[]}
          excludedKeys={METRIC_EXCLUDED_KEYS}
          sources={[...METRIC_ATTRIBUTE_SOURCES_UI]}
          onChange={(next) => onSearchChange(withQuery(selected.id, { attributes: next }))}
        />
      </ExploreFilterRail>
      <main className="flex min-h-0 min-w-0 flex-col">
        <MetricView
          metric={metric}
          kind={queryA.kind}
          entry={queryA.entry}
          aggregations={queryA.aggregations}
          aggregation={queryA.aggregation}
          groupBy={queryA.by}
          result={shown?.frame}
          lines={shown?.lines}
          metricPicker={pickerFor(queryA)}
          queryRows={queryRows}
          queryMetrics={multi ? queries.map((q) => q.metric) : undefined}
          onAddQuery={addQuery}
          allHidden={multi && queries.every((q) => hidden.has(q.id))}
          // Only on a chart drawn from current data: a kept one may be in
          // another aggregation's scale, or another range.
          exemplars={showExemplars && current ? exemplarsQuery.data : undefined}
          // A chart already on screen stays while its queries reload.
          isPending={
            !shown &&
            queries.some(
              (q) =>
                q.metadataPending ||
                q.quantilesPending ||
                (q.type && q.interval?.isPending) ||
                (q.aggregation && seriesQuery.isPending),
            )
          }
          error={error}
          onRetry={() => {
            for (const q of queries) {
              void q.metadata?.refetch();
              if (q.kind === "summary") void q.quantiles?.refetch();
              void q.interval?.refetch();
            }
            // Otherwise it starts on its own once what it waits for loads.
            if (seriesQuery.error) void seriesQuery.refetch();
          }}
          attributeRepo={attributeRepo}
          attributeDomain={`metrics:${queryA.type ?? ""}:${metric}`}
          timeRange={timeRange}
          backLink={renderCatalogLink}
          renderTraceLink={renderTraceLink}
          renderLogsLink={renderLogsLink}
          view={view}
          onViewChange={(view) => onSearchChange({ view })}
          onAggregationChange={(agg) => onSearchChange({ agg })}
          onGroupByChange={(by) => onSearchChange({ by })}
          onRangeSelect={onTimeRangeSelect}
        />
      </main>
    </>
  );
}
