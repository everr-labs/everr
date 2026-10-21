import { z } from "zod";
import { SqlAttributesSchema, SqlCountSchema, SqlTimestampSchema } from "../../sql/row-schemas";

export const ErrorIssueSummaryRowSchema = z.object({
  fingerprint: z.string(),
  exceptionType: z.string(),
  exceptionMessage: z.string(),
  body: z.string(),
  latestServiceName: z.string(),
  services: z.array(z.string()),
  occurrenceCount: SqlCountSchema,
  traceCount: SqlCountSchema,
  firstSeen: SqlTimestampSchema,
  lastSeen: SqlTimestampSchema,
  latestTraceId: z.string(),
  latestSpanId: z.string(),
  latestTimestamp: SqlTimestampSchema,
});
export type ErrorIssueSummaryRow = z.infer<typeof ErrorIssueSummaryRowSchema>;

export const ErrorOccurrenceRowSchema = z.object({
  timestampRank: SqlCountSchema.optional(),
  fingerprint: z.string(),
  timestamp: SqlTimestampSchema,
  serviceName: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  body: z.string(),
  exceptionType: z.string(),
  exceptionMessage: z.string(),
  exceptionStacktrace: z.string(),
  resourceAttributes: SqlAttributesSchema,
  logAttributes: SqlAttributesSchema,
  scopeAttributes: SqlAttributesSchema,
});
export type ErrorOccurrenceRow = z.infer<typeof ErrorOccurrenceRowSchema>;

export const ServiceRowSchema = z.object({ serviceName: z.string() });
