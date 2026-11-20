import {
  isValidTimeRange,
  StrictTimeRangeSearchSchema,
  TimeRangeSchema,
} from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  AttributeSourceSchema,
  attributesField,
  attributesList,
  attributeValuesInputSchema,
} from "../../attribute-filter/schemas";

const METRIC_ATTRIBUTE_SOURCES = ["resource", "metric"] as const;

/** The OTLP data point type, one per ClickHouse table. */
export const MetricTypeSchema = z.enum([
  "gauge",
  "sum",
  "histogram",
  "exponential_histogram",
  "summary",
]);
export type MetricType = z.infer<typeof MetricTypeSchema>;

/** What a metric is to the reader: a sum is a Counter or an UpDownCounter. */
export const MetricKindSchema = z.enum([
  "gauge",
  "counter",
  "updown",
  "histogram",
  "exponential_histogram",
  "summary",
]);
export type MetricKind = z.infer<typeof MetricKindSchema>;

const MetricAggregationSchema = z.enum([
  "avg",
  "min",
  "max",
  "sum",
  "rate",
  "increase",
  "p50",
  "p90",
  "p95",
  "p99",
]);
export type MetricAggregation = z.infer<typeof MetricAggregationSchema>;

/** How a histogram is drawn: a line per series, or bucket counts over time. */
const MetricViewSchema = z.enum(["lines", "heatmap"]);
export type MetricViewMode = z.infer<typeof MetricViewSchema>;

const GroupByKeySchema = z.object({
  source: AttributeSourceSchema,
  key: z.string().min(1),
});
export type GroupByKey = z.infer<typeof GroupByKeySchema>;

export const MAX_GROUP_BY = 3;

const groupByKeys = z
  .array(GroupByKeySchema)
  .max(MAX_GROUP_BY)
  .refine((keys) => keys.every((k) => k.source === "resource" || k.source === "metric"), {
    message: "group by source must be resource or metric",
  });
const groupByField = groupByKeys.default([]);

const MAX_EXTRA_QUERIES = 3;

/** A query after the first on a chart: its own metric, aggregation, group-by and filters. */
export const MetricChartQuerySchema = z.object({
  // Stable, so removing B leaves C as it is.
  id: z.enum(["B", "C", "D"]),
  metric: z.string().min(1),
  type: MetricTypeSchema,
  agg: MetricAggregationSchema.optional(),
  // Left out of the URL when empty.
  by: groupByKeys.optional(),
  attributes: attributesList(METRIC_ATTRIBUTE_SOURCES).optional(),
});
export type MetricChartQuery = z.infer<typeof MetricChartQuerySchema>;

export const MetricsSearchSchema = StrictTimeRangeSearchSchema.extend({
  // Catalog filters.
  q: z.string().default(""),
  types: z.array(MetricKindSchema).default([]),
  // The charted metric. Without one, the page shows the catalog.
  metric: z.string().optional(),
  metricType: MetricTypeSchema.optional(),
  agg: MetricAggregationSchema.optional(),
  view: MetricViewSchema.optional(),
  by: groupByField,
  attributes: attributesField(METRIC_ATTRIBUTE_SOURCES),
  // More queries on the same chart, B to D; the fields above are query A.
  queries: z
    .array(MetricChartQuerySchema)
    .max(MAX_EXTRA_QUERIES)
    // A hand-edited link can repeat a letter; the first query with it wins,
    // rather than the page failing on the link.
    .transform((queries) => queries.filter((q, i) => queries.findIndex((o) => o.id === q.id) === i))
    .default([]),
  // Queries kept but left off the chart, by letter.
  hidden: z
    .array(z.enum(["A", "B", "C", "D"]))
    .max(4)
    .default([]),
});
export type MetricsSearch = z.infer<typeof MetricsSearchSchema>;

// A range that ends before it starts has no buckets to chart.
const QueryTimeRangeSchema = TimeRangeSchema.refine((range) => isValidTimeRange(range), {
  message: "The time range must end after it starts.",
});

export const MetricCatalogInputSchema = z.object({
  timeRange: QueryTimeRangeSchema,
  q: z.string().default(""),
  /** Narrows to these kinds; a Counter and an UpDownCounter are both sums. */
  kinds: z.array(MetricKindSchema).default([]),
  service: z.array(z.string()).default([]),
  attributes: attributesField(METRIC_ATTRIBUTE_SOURCES),
});
export type MetricCatalogInput = z.input<typeof MetricCatalogInputSchema>;

/** Every metric in range, for the metric switcher and the Type filter's options. */
export const MetricNamesInputSchema = MetricCatalogInputSchema.pick({
  timeRange: true,
  service: true,
  attributes: true,
});
export type MetricNamesInput = z.input<typeof MetricNamesInputSchema>;

/** One metric, for its unit, description and temporality. */
export const MetricMetadataInputSchema = z.object({
  timeRange: QueryTimeRangeSchema,
  metric: z.string().min(1),
  /** The table to read; the same name can be in two. Every table when unknown. */
  type: MetricTypeSchema.optional(),
  service: z.array(z.string()).default([]),
  attributes: attributesField(METRIC_ATTRIBUTE_SOURCES),
});
export type MetricMetadataInput = z.input<typeof MetricMetadataInputSchema>;

export const MetricSeriesInputSchema = z.object({
  timeRange: QueryTimeRangeSchema,
  metric: z.string().min(1),
  type: MetricTypeSchema,
  aggregation: MetricAggregationSchema,
  groupBy: groupByField,
  service: z.array(z.string()).default([]),
  attributes: attributesField(METRIC_ATTRIBUTE_SOURCES),
  /** The metric's export interval in seconds; the step won't go below it. */
  minStep: z.number().positive().optional(),
  /** Histograms only: also count observations per bucket over time, for the heatmap. */
  heatmap: z.boolean().optional(),
});
export type MetricSeriesInput = z.input<typeof MetricSeriesInputSchema>;

export const MetricExportIntervalInputSchema = MetricSeriesInputSchema.omit({
  aggregation: true,
  groupBy: true,
  minStep: true,
  heatmap: true,
});
export type MetricExportIntervalInput = z.input<typeof MetricExportIntervalInputSchema>;

export const MetricExemplarsInputSchema = MetricSeriesInputSchema.omit({
  aggregation: true,
  heatmap: true,
});
export type MetricExemplarsInput = z.input<typeof MetricExemplarsInputSchema>;

export const MetricAttributeKeysInputSchema = z.object({
  timeRange: QueryTimeRangeSchema,
  metric: z.string().min(1),
  type: MetricTypeSchema,
});
export type MetricAttributeKeysInput = z.infer<typeof MetricAttributeKeysInputSchema>;

export const MetricAttributeValuesInputSchema = attributeValuesInputSchema(
  METRIC_ATTRIBUTE_SOURCES,
).and(z.object({ metric: z.string().min(1), type: MetricTypeSchema }));
export type MetricAttributeValuesInput = z.infer<typeof MetricAttributeValuesInputSchema>;

export const MetricFilterOptionsInputSchema = z.object({ timeRange: QueryTimeRangeSchema });
export type MetricFilterOptionsInput = z.input<typeof MetricFilterOptionsInputSchema>;

export const MetricSummaryQuantilesInputSchema = z.object({
  timeRange: QueryTimeRangeSchema,
  metric: z.string().min(1),
});
export type MetricSummaryQuantilesInput = z.input<typeof MetricSummaryQuantilesInputSchema>;
