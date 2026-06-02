import { isValid } from "@everr/datemath";
import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  AttributeSourceSchema,
  attributesField,
} from "../../attribute-filter/schemas";

export type {
  AttributeFilter,
  AttributeKey,
  AttributeOp,
  AttributeSource,
} from "../../attribute-filter/schemas";
export { AttributeFilterSchema } from "../../attribute-filter/schemas";

const datemath = z.string().refine(isValid);

export const TimeRangeSearchSchema = z.object({
  from: datemath.optional(),
  to: datemath.optional(),
  refresh: z.string().optional(),
});

export const ErrorSortSchema = z.enum(["lastSeen", "count"]);

// Issues fetched per infinite-scroll page.
export const PAGE_SIZE = 50;

export const ErrorIssueSearchSchema = TimeRangeSearchSchema.extend({
  q: z.string().trim().default(""),
  service: z.array(z.string()).default([]),
  fingerprint: z.string().trim().default(""),
  occurrence: z.string().trim().default(""),
  sort: ErrorSortSchema.default("lastSeen"),
  attributes: attributesField(["resource", "log", "scope"]),
});
export type ErrorIssueSearch = z.infer<typeof ErrorIssueSearchSchema>;

export const SearchErrorIssuesInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  q: z.string().trim().default(""),
  service: z.array(z.string()).default([]),
  fingerprint: z.string().trim().default(""),
  sort: ErrorSortSchema.default("lastSeen"),
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  attributes: attributesField(["resource", "log", "scope"]),
});
export type SearchErrorIssuesInput = z.infer<
  typeof SearchErrorIssuesInputSchema
>;

export const GetErrorIssueInputSchema = z.object({
  fingerprint: z.string().min(1),
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  service: z.array(z.string()).default([]),
  occurrenceLimit: z.number().int().positive().max(200).default(50),
});
export type GetErrorIssueInput = z.infer<typeof GetErrorIssueInputSchema>;

// Input shape the occurrences SQL builder needs.
export type GetErrorIssuesQueryInput = GetErrorIssueInput;

export const ListErrorServicesInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  attributes: attributesField(["resource", "log", "scope"]),
});
export type ListErrorServicesInput = z.infer<
  typeof ListErrorServicesInputSchema
>;

export const ErrorAttributeKeysInputSchema = z.object({
  timeRange: TimeRangeSchema,
});
export type ErrorAttributeKeysInput = z.infer<
  typeof ErrorAttributeKeysInputSchema
>;

export const ErrorAttributeValuesInputSchema = z.object({
  timeRange: TimeRangeSchema,
  source: AttributeSourceSchema,
  key: z.string().min(1),
  search: z.string().optional(),
});
export type ErrorAttributeValuesInput = z.infer<
  typeof ErrorAttributeValuesInputSchema
>;
