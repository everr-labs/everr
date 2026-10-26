import type { ConsultationPrincipal, ConsultedTrace } from "#app/organizations/consultations.ts";
import { consultations } from "#app/server/organizations/consultations.ts";
import { serverLogger } from "#app/telemetry/logger.ts";

export type { ConsultationPrincipal } from "#app/organizations/consultations.ts";

// This is deliberately a complete, small grammar, not a SQL classifier. A raw
// table read cannot manufacture ResourceAttributes through aliases or constants.
// All other valid SQL still runs normally, without reporting a trace consultation.
const traceDetailSql =
  /^\s*SELECT\s+\*\s+FROM\s+traces\s+WHERE\s+TraceId\s*=\s*'([a-f\d]{32})'(?:\s+AND\s+ServiceName\s*=\s*'[\w.-]+'\s+AND\s+Timestamp\s*>=\s*'[^'\\]+'\s+AND\s+Timestamp\s*<\s*'[^'\\]+')?\s+(?:ORDER\s+BY\s+Timestamp(?:\s+(?:ASC|DESC))?\s+)?LIMIT\s+([1-9]\d{0,3})\s*;?\s*$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

/** Ancillary synchronous evidence inspection never changes the successful read. */
function contain(completion: () => void) {
  try {
    completion();
  } catch {
    try {
      serverLogger.error("organization.consultations.failed", {
        "everr.consultation.failure_stage": "completion",
      });
    } catch {
      // A broken observer or logger cannot turn a completed consultation into an error.
    }
  }
}

/** Only called by the explicit UI route loader, never by shared poll/refetch reads. */
export function observeTraceDetail(args: {
  principal: ConsultationPrincipal;
  rows: readonly ConsultedTrace[];
}) {
  contain(() => {
    if (args.rows.length)
      consultations.observe({
        principal: args.principal,
        surface: "ui",
        traces: args.rows
          .slice(0, 1000)
          .map(({ traceId, serviceName, resourceAttributes, spanAttributes }) => ({
            traceId,
            serviceName,
            resourceAttributes,
            spanAttributes,
          })),
      });
  });
}

/** The caller must pass rows actually included in its successful response. */
export function observeTraceQuery(args: {
  principal: ConsultationPrincipal;
  surface: "cli" | "mcp";
  sql: string;
  rows: readonly unknown[];
  columns?: readonly string[];
}) {
  contain(() => {
    const query = traceDetailSql.exec(args.sql);
    if (!query || Number(query[2]) > 1000) return;
    const columns = args.columns;
    const rows = args.rows.slice(0, 1000).flatMap((value): ConsultedTrace[] => {
      const row =
        Array.isArray(value) && columns
          ? Object.fromEntries(
              ["TraceId", "ServiceName", "ResourceAttributes", "SpanAttributes"].map((key) => [
                key,
                value[columns.indexOf(key)],
              ]),
            )
          : record(value);
      return row?.TraceId === query[1] && typeof row.ServiceName === "string"
        ? [
            {
              traceId: row.TraceId,
              serviceName: row.ServiceName,
              resourceAttributes: row.ResourceAttributes,
              spanAttributes: row.SpanAttributes,
            },
          ]
        : [];
    });
    if (rows.length)
      consultations.observe({ principal: args.principal, surface: args.surface, traces: rows });
  });
}
