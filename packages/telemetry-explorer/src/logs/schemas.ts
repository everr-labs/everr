import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  type AttributeKey,
  type AttributeKeysInput,
  type AttributeValuesInput,
  attributesField,
  attributeValuesInputSchema,
} from "../attribute-filter/schemas";

export const LogLevelSchema = z.enum(["error", "warning", "info", "debug", "trace", "unknown"]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

export type { AttributeFilter, AttributeOp, AttributeSource } from "../attribute-filter/schemas";
// Re-export the shared attribute types under both generic and historical names.
export {
  AttributeFilterSchema,
  AttributeOpSchema,
  AttributeSourceSchema,
} from "../attribute-filter/schemas";

export type LogAttributeKey = AttributeKey;
export type LogAttributeKeysInput = AttributeKeysInput;
export type LogAttributeValuesInput = AttributeValuesInput;

export const LogAttributeKeysInputSchema = z.object({
  timeRange: TimeRangeSchema,
});

export const LogAttributeValuesInputSchema = attributeValuesInputSchema([
  "resource",
  "log",
  "scope",
]);

export const LogsSearchFiltersShape = {
  levels: z.array(LogLevelSchema).default([]),
  services: z.array(z.string()).default([]),
  attributes: attributesField(["resource", "log", "scope"]),
} as const;

const LogsFilterShape = {
  timeRange: TimeRangeSchema,
  query: z.string().trim().optional(),
  ...LogsSearchFiltersShape,
  traceId: z.string().trim().optional(),
} as const;

export const LogsExplorerInputSchema = z.object({
  ...LogsFilterShape,
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
});
export type LogsExplorerInput = z.infer<typeof LogsExplorerInputSchema>;

export const LogsTotalsInputSchema = z.object(LogsFilterShape);
export type LogsTotalsInput = z.infer<typeof LogsTotalsInputSchema>;

export const LogHistogramInputSchema = z.object({
  ...LogsFilterShape,
  histogramBuckets: z.number().int().min(12).max(240).default(80),
});
export type LogHistogramInput = z.infer<typeof LogHistogramInputSchema>;

export const LogIdentitySchema = z.object({
  timestampRaw: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  serviceName: z.string(),
  bodyHash: z.string(),
});
export type LogIdentity = z.infer<typeof LogIdentitySchema>;

export interface LogExplorerRow {
  id: string;
  identity: LogIdentity;
  timestamp: string;
  level: LogLevel;
  body: string;
}

export interface LogDetail {
  timestamp: string;
  level: LogLevel;
  severityText: string;
  severityNumber: number;
  serviceName: string;
  traceId: string;
  spanId: string;
  resourceAttributes: Record<string, string>;
  logAttributes: Record<string, string>;
  scopeAttributes: Record<string, string>;
}

export interface LogHistogramBucket {
  timestamp: string;
  endTimestamp: string;
  total: number;
  error: number;
  warning: number;
  info: number;
  debug: number;
  trace: number;
  unknown: number;
}

export interface LogsExplorerResult {
  logs: LogExplorerRow[];
}

export interface LogsTotalsResult {
  totalCount: number;
  levelCounts: Record<LogLevel, number>;
}

export interface LogFilterOptions {
  services: string[];
}
