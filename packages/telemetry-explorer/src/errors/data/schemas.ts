import { isValid } from "@everr/datemath";
import { z } from "zod";

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
});
export type ListErrorServicesInput = z.infer<
  typeof ListErrorServicesInputSchema
>;
