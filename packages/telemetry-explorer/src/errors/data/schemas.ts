import { isValid } from "@everr/datemath";
import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  attributesField,
  attributeValuesInputSchema,
} from "../../attribute-filter/schemas";

export type {
  AttributeFilter,
  AttributeKey,
  AttributeOp,
  AttributeSource,
} from "../../attribute-filter/schemas";
export { AttributeFilterSchema } from "../../attribute-filter/schemas";

const optionalDatemath = z.preprocess(
  (value) => (typeof value === "string" && isValid(value) ? value : undefined),
  z.string().optional(),
);
const optionalSearchString = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().optional(),
);
const searchString = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string().trim(),
);

export const TimeRangeSearchSchema = z.object({
  from: optionalDatemath,
  to: optionalDatemath,
  refresh: optionalSearchString,
});

export const ErrorSortSchema = z.enum(["lastSeen", "count"]);

// Issues fetched per infinite-scroll page.
export const PAGE_SIZE = 50;

export const ErrorIssueSearchSchema = TimeRangeSearchSchema.extend({
  q: searchString,
  service: z.array(z.string()).catch([]).default([]),
  fingerprint: searchString,
  occurrence: searchString,
  sort: ErrorSortSchema.default("lastSeen").catch("lastSeen"),
  attributes: attributesField(["resource", "log", "scope"]).catch([]),
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

export const ListErrorTriageEventsInputSchema = z.object({
  fingerprint: z.string().min(1),
  limit: z.number().int().positive().max(1000).default(500),
});
export type ListErrorTriageEventsInput = z.infer<
  typeof ListErrorTriageEventsInputSchema
>;

const investigationBody = z
  .string()
  .trim()
  .min(1)
  .max(64 * 1024);

// Write inputs carry only what the client is allowed to say: tenant and
// author are stamped server-side from the session, never accepted as input.
export const CreateErrorInvestigationInputSchema = z.object({
  fingerprint: z.string().min(1).max(200),
  body: investigationBody,
});
export type CreateErrorInvestigationInput = z.infer<
  typeof CreateErrorInvestigationInputSchema
>;

export const UpdateErrorInvestigationInputSchema = z.object({
  eventId: z.string().uuid(),
  body: investigationBody,
});
export type UpdateErrorInvestigationInput = z.infer<
  typeof UpdateErrorInvestigationInputSchema
>;

export const DeleteErrorInvestigationInputSchema = z.object({
  eventId: z.string().uuid(),
});
export type DeleteErrorInvestigationInput = z.infer<
  typeof DeleteErrorInvestigationInputSchema
>;

export const ErrorAttributeKeysInputSchema = z.object({
  timeRange: TimeRangeSchema,
});
export type ErrorAttributeKeysInput = z.infer<
  typeof ErrorAttributeKeysInputSchema
>;

export const ErrorAttributeValuesInputSchema = attributeValuesInputSchema([
  "resource",
  "log",
  "scope",
]);
export type ErrorAttributeValuesInput = z.infer<
  typeof ErrorAttributeValuesInputSchema
>;
