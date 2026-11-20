import { FilterSearchBar } from "@everr/ui/components/filter-search-bar";
import { Label } from "@everr/ui/components/label";
import { Shapes } from "lucide-react";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useQueries, useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
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
import { AddMetricButton, QueryRow } from "./chart-queries";
import { METRIC_KIND_SHORT_LABELS } from "./format";
import type { ExemplarLinkRenderProps } from "./exemplar-card";
import { MetricCatalog, type MetricLinkRenderProps } from "./metric-catalog";
import { type ChartLine, MetricView, seriesLabel } from "./metric-view";
import type { MetricPickerProps } from "./metric-picker";

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
            onChange={(next) =>
              onSearchChange({
                types: next.flatMap((t) => {
                  const parsed = MetricKindSchema.safeParse(t);
                  return parsed.success ? [parsed.data] : [];
                }),
              })
            }
            options={metricKindOptions(repo, {
              timeRange,
              service,
              attributes: withEnvironment([], environment),
            })}
            formatValue={(value) => {
              const parsed = MetricKindSchema.safeParse(value);
              return parsed.success ? METRIC_KIND_SHORT_LABELS[parsed.data] : value;
            }}
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

type QuerySpec = {
  id: MetricsSearch["hidden"][number];
  metric: string;
  type: MetricType | undefined;
  agg: MetricAggregation | undefined;
  by: GroupByKey[];
  attributes: AttributeFilter[];
};

const QUERY_IDS = ["B", "C", "D"] as const;

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

  // Every metric in range, for the metric switcher: names and types only,
  // as the full catalog's counts take seconds over long ranges.
  const allMetrics = useQuery(
    metricNamesOptions(repo, { timeRange, service, attributes: environmentOnly }, refresh),
  );
  const entryQuery = useQuery(
    metricMetadataOptions(
      repo,
      { timeRange, metric, type: search.metricType, service, attributes: environmentOnly },
      refresh,
    ),
  );
  const entry = entryQuery.data ?? undefined;

  // Query A is the page's own metric fields; B to D come from `queries`.
  const queryA: QuerySpec = {
    id: "A",
    metric,
    type: search.metricType ?? entry?.type,
    agg: search.agg,
    by: search.by,
    attributes: search.attributes,
  };
  const specs: QuerySpec[] = [
    queryA,
    ...search.queries.map((q) => ({
      id: q.id,
      metric: q.metric,
      type: q.type,
      agg: q.agg,
      by: q.by,
      attributes: q.attributes,
    })),
  ];
  const multi = specs.length > 1;
  const hidden = new Set<string>(search.hidden);

  // The other queries' metadata (unit, temporality), one metric each.
  const otherEntryQueries = useQueries({
    queries: search.queries.map((q) =>
      metricMetadataOptions(
        repo,
        { timeRange, metric: q.metric, type: q.type, service, attributes: environmentOnly },
        refresh,
      ),
    ),
  });
  const entries = [entry, ...otherEntryQueries.map((query) => query.data ?? undefined)];
  // A sum's kind needs its metadata; until then, offer nothing rather than
  // guess between a counter's rate and an UpDownCounter's sum.
  const kinds = specs.map((q, i) =>
    q.type && (q.type !== "sum" || entries[i])
      ? metricKind(q.type, entries[i]?.isMonotonic ?? false)
      : null,
  );
  const quantileQueries = useQueries({
    queries: specs.map((q, i) => ({
      ...metricSummaryQuantilesOptions(repo, { timeRange, metric: q.metric }),
      enabled: kinds[i] === "summary",
    })),
  });
  // A summary offers only the quantiles it reports, so its aggregation waits
  // for them instead of defaulting to one that may not exist.
  const aggregationLists = specs.map((_, i) => {
    const kind = kinds[i];
    if (!kind) return [];
    if (kind !== "summary") return aggregationsFor(kind);
    const reported = quantileQueries[i]?.data;
    return reported ? summaryAggregations(reported) : [];
  });
  const aggregations = specs.map((q, i) => {
    const list = aggregationLists[i] ?? [];
    const kind = kinds[i];
    if (q.agg && list.includes(q.agg)) return q.agg;
    return kind && list.length > 0 ? defaultAggregation(kind, list) : null;
  });

  const attributesOf = (q: QuerySpec) => withEnvironment(q.attributes, environment);
  // The chart is never finer than the slowest query's export interval, so
  // every query, and the exemplars, share one step and line up.
  const intervalQueries = useQueries({
    queries: specs.map((q) => ({
      ...metricExportIntervalOptions(repo, {
        timeRange,
        metric: q.metric,
        type: q.type ?? "gauge",
        service,
        attributes: attributesOf(q),
      }),
      enabled: Boolean(q.type),
    })),
  });
  const intervalsReady = specs.every((q, i) => !q.type || intervalQueries[i]?.isSuccess);
  const minStep = Math.max(0, ...intervalQueries.map((query) => query.data ?? 0)) || undefined;
  const seriesQueries = useQueries({
    queries: specs.map((q, i) => ({
      ...metricSeriesOptions(
        repo,
        {
          timeRange,
          metric: q.metric,
          type: q.type ?? "gauge",
          aggregation: aggregations[i] ?? "avg",
          groupBy: q.by,
          service,
          attributes: attributesOf(q),
          minStep,
        },
        refresh,
      ),
      enabled: Boolean(q.type && aggregations[i]) && intervalsReady,
    })),
  });

  const kind = kinds[0] ?? null;
  const aggregation = aggregations[0] ?? null;
  const showExemplars =
    !multi &&
    kind !== null &&
    kind !== "counter" &&
    // Summaries carry no exemplars.
    kind !== "summary" &&
    aggregation !== null &&
    EXEMPLAR_AGGREGATIONS.has(aggregation) &&
    (!isHistogramKind(kind) || (search.view ?? "lines") === "lines");
  const exemplarsQuery = useQuery({
    ...metricExemplarsOptions(
      repo,
      {
        timeRange,
        metric,
        type: specs[0]?.type ?? "gauge",
        groupBy: search.by,
        service,
        attributes: attributesOf(queryA),
        minStep,
      },
      refresh,
    ),
    enabled: showExemplars && intervalsReady,
  });

  const results = seriesQueries.map((query) => query.data);
  const primary = results[0];
  const allLoaded = results.every((r, i) => r !== undefined || !specs[i]?.type);

  // Recomputed when any query's data, or what's drawn from it, changes.
  const drawKey = JSON.stringify([
    seriesQueries.map((query) => query.dataUpdatedAt),
    specs.map((q) => [q.id, q.metric]),
    aggregations,
    kinds,
    entries.map((e) => e?.unit),
    search.hidden,
  ]);
  const lines = useMemo(() => {
    if (!primary || !allLoaded) return undefined;
    const out: ChartLine[] = [];
    specs.forEach((q, i) => {
      const result = results[i];
      if (!result || (multi && hidden.has(q.id))) return;
      const unit = valueUnit(kinds[i] ?? null, aggregations[i] ?? null, entries[i]?.unit ?? "");
      for (const s of result.series.slice(0, SERIES_ON_CHART)) {
        // Under its query's heading, a series grouped by nothing needs no name.
        const name =
          multi && s.labels.length === 0 ? "all series" : seriesLabel(s.labels, q.metric);
        out.push({
          id: multi ? `${q.id}\u0000${s.labels.join("\u0000")}` : s.labels.join("\u0000") || metric,
          label: multi ? `${q.id} · ${seriesLabel(s.labels, q.metric)}` : name,
          name,
          ...(multi
            ? { query: { id: q.id, metric: q.metric, aggregation: aggregations[i] ?? null } }
            : {}),
          values: s.values,
          unit,
          aggregation: aggregations[i] ?? null,
        });
      }
    });
    return out;
    // Everything read above is captured by drawKey.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKey, primary, allLoaded]);

  const attributeRepoFor = (q: QuerySpec): AttributeRepositoryLike => ({
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
  const [selectedId, setSelectedId] = useState("A");
  const selectedIndex = Math.max(
    0,
    specs.findIndex((q) => q.id === selectedId),
  );
  const selected = specs[selectedIndex] ?? queryA;
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

  const updateQuery = (id: string, patch: Partial<Omit<QuerySpec, "id">>) => {
    if (id === "A") {
      onSearchChange({
        ...(patch.metric !== undefined ? { metric: patch.metric } : {}),
        ...(patch.type !== undefined ? { metricType: patch.type } : {}),
        ...("agg" in patch ? { agg: patch.agg } : {}),
        ...(patch.by !== undefined ? { by: patch.by } : {}),
        ...(patch.attributes !== undefined ? { attributes: patch.attributes } : {}),
      });
      return;
    }
    onSearchChange({
      queries: search.queries.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    });
  };
  const freeQueryId = QUERY_IDS.find((id) => !search.queries.some((q) => q.id === id));
  const addQuery = freeQueryId
    ? () => {
        // A copy of the last query, ready to change: the usual next step is
        // the same metric with another filter, or a sibling metric.
        const last = specs[specs.length - 1];
        if (!last?.type) return;
        onSearchChange({
          view: undefined,
          queries: [
            ...search.queries,
            {
              id: freeQueryId,
              metric: last.metric,
              type: last.type,
              agg: aggregations[specs.length - 1] ?? undefined,
              by: last.by,
              attributes: last.attributes,
            },
          ],
        });
        setSelectedId(freeQueryId);
      }
    : undefined;

  const removeQuery = (id: string) => {
    // Back to one query, the page has no hide toggle, so nothing stays hidden.
    const single = search.queries.length === 1;
    if (id !== "A") {
      onSearchChange({
        queries: search.queries.filter((q) => q.id !== id),
        hidden: single ? [] : search.hidden.filter((h) => h !== id),
      });
      if (selected.id === id) setSelectedId("A");
      return;
    }
    // Query A is the page's own fields, so the next query moves into them and
    // becomes A.
    const [next, ...rest] = search.queries;
    if (!next) return;
    onSearchChange({
      metric: next.metric,
      metricType: next.type,
      agg: next.agg,
      view: undefined,
      by: next.by,
      attributes: next.attributes,
      queries: rest,
      hidden: single
        ? []
        : search.hidden.flatMap((h) => (h === "A" ? [] : h === next.id ? ["A" as const] : [h])),
    });
    if (selected.id === "A" || selected.id === next.id) setSelectedId("A");
  };

  // Switching a query's metric drops what only made sense for the old one.
  const pickerFor = (q: QuerySpec): MetricPickerProps => ({
    metrics: allMetrics.data,
    value: { name: q.metric, type: q.type },
    onChange: ({ name, type }) => {
      if (!multi) {
        onSearchChange({ ...CLEAR_METRIC, metric: name, metricType: type });
      } else if (q.id === "A") {
        onSearchChange({
          metric: name,
          metricType: type,
          agg: undefined,
          view: undefined,
          by: [],
          attributes: [],
        });
      } else {
        updateQuery(q.id, { metric: name, type, agg: undefined, by: [], attributes: [] });
      }
    },
  });

  const queryRows = multi ? (
    <>
      {specs.map((q, i) => (
        <QueryRow
          key={q.id}
          id={q.id}
          metric={q.metric}
          kind={kinds[i] ?? null}
          entry={entries[i]}
          picker={pickerFor(q)}
          selected={selected.id === q.id}
          filterCount={q.attributes.length}
          aggregations={aggregationLists[i] ?? []}
          aggregation={aggregations[i] ?? null}
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
          onAggregationChange={(agg) => updateQuery(q.id, { agg })}
          onGroupByChange={(by) => updateQuery(q.id, { by })}
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

  const seriesError = seriesQueries.find((query) => query.error)?.error ?? null;
  const intervalError = intervalQueries.find((query) => query.error)?.error ?? null;

  return (
    <>
      <ExploreFilterRail
        label="Metric filters"
        persistentFilters={persistentFilters}
        persistentFilterCount={countPersistentFilters(service, environment)}
        pageFilterCount={selected.attributes.length ?? 0}
        onClear={() => updateQuery(selected.id ?? "A", { attributes: [] })}
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
          domain={`metrics:${selected.type ?? ""}:${selected.metric ?? metric}`}
          timeRange={timeRange}
          attributes={selected.attributes ?? []}
          promotedAttributes={[]}
          excludedKeys={METRIC_EXCLUDED_KEYS}
          sources={[...METRIC_ATTRIBUTE_SOURCES_UI]}
          onChange={(next) => updateQuery(selected.id ?? "A", { attributes: next })}
        />
      </ExploreFilterRail>
      <main className="flex min-h-0 min-w-0 flex-col">
        <MetricView
          metric={metric}
          kind={kind}
          entry={entry}
          aggregations={aggregationLists[0] ?? []}
          aggregation={aggregation}
          groupBy={search.by}
          result={primary}
          lines={lines}
          metricPicker={pickerFor(queryA)}
          queryRows={queryRows}
          queryMetrics={multi ? specs.map((q) => q.metric) : undefined}
          addControls={<AddMetricButton onAdd={addQuery} />}
          exemplars={showExemplars ? exemplarsQuery.data : undefined}
          isPending={
            entryQuery.isPending ||
            specs.some(
              (q, i) =>
                (kinds[i] === "summary" && quantileQueries[i]?.isPending) ||
                (q.type && intervalQueries[i]?.isPending) ||
                (Boolean(aggregations[i]) && seriesQueries[i]?.isPending),
            )
          }
          error={seriesError ?? intervalError ?? entryQuery.error}
          onRetry={() => {
            void entryQuery.refetch();
            intervalQueries.forEach((query) => void query.refetch());
            seriesQueries.forEach((query) => void query.refetch());
          }}
          attributeRepo={attributeRepo}
          attributeDomain={`metrics:${specs[0]?.type ?? ""}:${metric}`}
          timeRange={timeRange}
          backLink={renderCatalogLink}
          renderTraceLink={renderTraceLink}
          renderLogsLink={renderLogsLink}
          view={!multi && isHistogramKind(kind) ? (search.view ?? "lines") : "lines"}
          onViewChange={(view) => onSearchChange({ view })}
          onAggregationChange={(agg) => onSearchChange({ agg })}
          onGroupByChange={(by) => onSearchChange({ by })}
          onRangeSelect={onTimeRangeSelect}
        />
      </main>
    </>
  );
}

const SERIES_ON_CHART = 10;
