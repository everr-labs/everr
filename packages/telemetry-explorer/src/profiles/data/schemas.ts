import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  type AttributeSource,
  attributesField,
  attributeValuesInputSchema,
} from "../../attribute-filter/schemas";
import { TimeRangeSearchSchema } from "../../traces/time-range";
import { BASELINES } from "../model/diff";

export const PROFILES_ATTRIBUTE_SOURCES: readonly AttributeSource[] = ["resource", "sample"];

// `service` and `environment` are not here: the host apps share them with the
// other Explore pages and add them to their route schema.
export const ProfilesSearchParamsSchema = TimeRangeSearchSchema.extend({
  q: z.string().default("").catch(""),
  sampleType: z.string().optional().catch(undefined),
  sampleUnit: z.string().optional().catch(undefined),
  traceId: z.string().optional().catch(undefined),
  spanId: z.string().optional().catch(undefined),
  attributes: attributesField(PROFILES_ATTRIBUTE_SOURCES).catch([]),
  showVolume: z.boolean().default(true).catch(true),
  /** The window to diff against; absent when not comparing. */
  compare: z.enum(BASELINES).optional().catch(undefined),
  /** The `custom` baseline window, picked by dragging on the histogram. */
  baseFrom: z.string().optional().catch(undefined),
  baseTo: z.string().optional().catch(undefined),
  /** The `version` comparison's two `service.version` values; absent picks the latest two. */
  version: z.string().optional().catch(undefined),
  baseVersion: z.string().optional().catch(undefined),
  /** The function the callers and callees view centers on. */
  fn: z
    .object({ name: z.string(), file: z.string().default("") })
    .optional()
    .catch(undefined),
});
export type ProfilesSearchParams = z.infer<typeof ProfilesSearchParamsSchema>;

/** Distinct stacks per flame graph. Enough detail for a readable graph, small enough to send. */
export const PROFILE_STACK_LIMIT = 5_000;

/** Bars in the samples histogram, the same target as the logs volume. */
export const PROFILE_HISTOGRAM_BUCKETS = 60;

export const PROFILE_EXAMPLE_TRACE_LIMIT = 20;

const AttributeFilterArraySchema = attributesField(PROFILES_ATTRIBUTE_SOURCES);

// Every query on the page narrows by the same filters, so a flame graph, its
// sample types and its histogram always describe the same samples.
const FilterShape = {
  timeRange: TimeRangeSchema,
  services: z.array(z.string()).default([]),
  /** `service.version` values. */
  versions: z.array(z.string()).default([]),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional(),
  q: z.string().default(""),
  attributes: AttributeFilterArraySchema,
};

export const ProfileFilterInputSchema = z.object(FilterShape);
export type ProfileFilterInput = z.input<typeof ProfileFilterInputSchema>;

const SampleTypeShape = { sampleType: z.string(), sampleUnit: z.string() };

export const ProfileStacksInputSchema = z.object({
  ...FilterShape,
  ...SampleTypeShape,
  limit: z.number().int().positive().max(20_000).default(PROFILE_STACK_LIMIT),
});
export type ProfileStacksInput = z.input<typeof ProfileStacksInputSchema>;

export const ProfileHistogramInputSchema = z.object({
  ...FilterShape,
  ...SampleTypeShape,
  buckets: z.number().int().positive().max(500).default(PROFILE_HISTOGRAM_BUCKETS),
});
export type ProfileHistogramInput = z.input<typeof ProfileHistogramInputSchema>;

/** Timestamped samples per span timeline: 50 s of span time at 100 Hz. */
export const PROFILE_TIMELINE_SAMPLE_LIMIT = 5_000;

export const ProfileSpanTimelineInputSchema = z.object({
  timeRange: TimeRangeSchema,
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  ...SampleTypeShape,
  limit: z.number().int().positive().max(20_000).default(PROFILE_TIMELINE_SAMPLE_LIMIT),
});
export type ProfileSpanTimelineInput = z.input<typeof ProfileSpanTimelineInputSchema>;

export const ProfiledSpansInputSchema = z.object({
  timeRange: TimeRangeSchema,
  traceId: z.string().min(1),
});
export type ProfiledSpansInput = z.input<typeof ProfiledSpansInputSchema>;

export const ProfileExampleTracesInputSchema = z.object({
  ...FilterShape,
  ...SampleTypeShape,
  functionName: z.string(),
  limit: z.number().int().positive().max(100).default(PROFILE_EXAMPLE_TRACE_LIMIT),
});
export type ProfileExampleTracesInput = z.input<typeof ProfileExampleTracesInputSchema>;

export const ProfileServicesInputSchema = z.object({ timeRange: TimeRangeSchema });
export type ProfileServicesInput = z.infer<typeof ProfileServicesInputSchema>;

export const ProfileAttributeValuesInputSchema = attributeValuesInputSchema(
  PROFILES_ATTRIBUTE_SOURCES,
);
