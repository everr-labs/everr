import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { attributesField, attributeValuesInputSchema } from "../../attribute-filter/schemas";
import { TimeRangeSearchSchema } from "../time-range";

export type {
  AttributeFilter,
  AttributeKey,
  AttributeOp,
  AttributeSource,
} from "../../attribute-filter/schemas";
export { AttributeFilterSchema } from "../../attribute-filter/schemas";

const SpanStatusFilterSchema = z.enum(["ok", "error", "all"]);
export type SpanStatusFilter = z.infer<typeof SpanStatusFilterSchema>;

export const TraceSearchParamsSchema = TimeRangeSearchSchema.extend({
  namespace: z.array(z.string()).default([]),
  service: z.array(z.string()).default([]),
  name: z.string().default(""),
  minMs: z.number().int().nonnegative().optional(),
  maxMs: z.number().int().nonnegative().optional(),
  status: SpanStatusFilterSchema.default("all"),
  attributes: attributesField(["resource", "span"]),
});
export type TraceSearchParams = z.infer<typeof TraceSearchParamsSchema>;

export const TraceDetailParamsSchema = TraceSearchParamsSchema.extend({
  span: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});
export type TraceDetailParams = z.infer<typeof TraceDetailParamsSchema>;

export function toTraceListSearch(search: TraceDetailParams): TraceSearchParams {
  const { span: _span, start: _start, end: _end, ...listSearch } = search;
  return listSearch;
}

export const SearchTracesInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  cursorStartTs: z.string().min(1).optional(),
  cursorTraceId: z.string().min(1).optional(),
  namespace: z.array(z.string()).default([]),
  service: z.array(z.string()).default([]),
  name: z.string().default(""),
  minDurationNs: z.string().optional(),
  maxDurationNs: z.string().optional(),
  status: SpanStatusFilterSchema.default("all"),
  attributes: attributesField(["resource", "span"]),
  limit: z.number().int().positive().max(500).default(50),
});
export type SearchTracesInput = z.infer<typeof SearchTracesInputSchema>;

export const GetTraceInputSchema = z.object({
  traceId: z.string().min(1),
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
});
export type GetTraceInput = z.infer<typeof GetTraceInputSchema>;

export const ListServiceIdentitiesInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
});
export type ListServiceIdentitiesInput = z.infer<typeof ListServiceIdentitiesInputSchema>;

export const TraceAttributeKeysInputSchema = z.object({
  timeRange: TimeRangeSchema,
});
export type TraceAttributeKeysInput = z.infer<typeof TraceAttributeKeysInputSchema>;

export const TraceAttributeValuesInputSchema = attributeValuesInputSchema(["resource", "span"]);
export type TraceAttributeValuesInput = z.infer<typeof TraceAttributeValuesInputSchema>;
