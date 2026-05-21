import { z } from "zod";
import { TimeRangeSearchSchema } from "../time-range";

const SpanStatusFilterSchema = z.enum(["ok", "error", "all"]);
export type SpanStatusFilter = z.infer<typeof SpanStatusFilterSchema>;

export const TraceSearchParamsSchema = TimeRangeSearchSchema.extend({
  namespace: z.array(z.string()).default([]),
  service: z.array(z.string()).default([]),
  name: z.string().default(""),
  minMs: z.number().int().nonnegative().optional(),
  maxMs: z.number().int().nonnegative().optional(),
  status: SpanStatusFilterSchema.default("all"),
  limit: z.number().int().positive().max(500).default(50),
});
export type TraceSearchParams = z.infer<typeof TraceSearchParamsSchema>;

export const TraceDetailParamsSchema = TraceSearchParamsSchema.extend({
  span: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});
export type TraceDetailParams = z.infer<typeof TraceDetailParamsSchema>;

export function toTraceListSearch(
  search: TraceDetailParams,
): TraceSearchParams {
  const { span: _span, start: _start, end: _end, ...listSearch } = search;
  return listSearch;
}

export const SearchTracesInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  namespace: z.array(z.string()).default([]),
  service: z.array(z.string()).default([]),
  name: z.string().default(""),
  minDurationNs: z.string().optional(),
  maxDurationNs: z.string().optional(),
  status: SpanStatusFilterSchema.default("all"),
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
export type ListServiceIdentitiesInput = z.infer<
  typeof ListServiceIdentitiesInputSchema
>;
