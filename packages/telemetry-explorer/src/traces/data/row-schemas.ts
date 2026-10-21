import { z } from "zod";
import {
  SqlAttributesSchema,
  SqlCountSchema,
  SqlIntegerTextSchema,
  SqlTimestampSchema,
  SqlUnsignedIntegerTextSchema,
} from "../../sql/row-schemas";

// ClickHouse defaults omitted String columns to empty text. Older spans with
// that default have no explicit status, the same meaning as OTel Unset.
const SpanStatusSchema = z
  .enum(["Ok", "Error", "Unset", ""])
  .transform((status) => (status === "" ? "Unset" : status));

export const TraceSummaryRowSchema = z.object({
  traceId: z.string(),
  rootName: z.string(),
  rootService: z.string(),
  rootNamespace: z.string(),
  rootStatus: SpanStatusSchema,
  rootStatusCode: z.string(),
  startTs: SqlTimestampSchema,
  durationNs: SqlUnsignedIntegerTextSchema,
  spanCount: SqlCountSchema.transform(Number),
  errorCount: SqlCountSchema.transform(Number),
  services: z.array(z.string()),
});

export const SpanRowSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string(),
  spanName: z.string(),
  serviceName: z.string(),
  serviceNamespace: z.string(),
  timestamp: SqlTimestampSchema,
  timestampNs: SqlIntegerTextSchema,
  duration: SqlUnsignedIntegerTextSchema,
  statusCode: SpanStatusSchema,
  spanKind: z.string(),
  spanAttributes: SqlAttributesSchema,
  resourceAttributes: SqlAttributesSchema,
  eventNames: z.array(z.string()),
  eventTimestamps: z.array(SqlTimestampSchema),
  eventAttributes: z.array(SqlAttributesSchema),
  linkTraceIds: z.array(z.string()),
  linkSpanIds: z.array(z.string()),
  linkAttributes: z.array(SqlAttributesSchema),
});
export type SpanRow = z.infer<typeof SpanRowSchema>;

export const ServiceIdentityRowSchema = z.object({
  serviceNamespace: z.string(),
  serviceName: z.string(),
});
