// fallow-ignore-file duplicate-export
import { z } from "zod";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const ErrorSortSchema = z.enum(["lastSeen", "count"]);
export type ErrorSort = z.infer<typeof ErrorSortSchema>;

export const ErrorIssueSearchSchema = TimeRangeSearchSchema.extend({
  q: z.string().trim().default(""),
  service: z.array(z.string()).default([]),
  fingerprint: z.string().trim().default(""),
  occurrence: z.string().trim().default(""),
  sort: ErrorSortSchema.default("lastSeen"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
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

export const ListErrorServicesInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
});
export type ListErrorServicesInput = z.infer<
  typeof ListErrorServicesInputSchema
>;
