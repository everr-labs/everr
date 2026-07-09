import type {
  LogEventEmitter,
  LogEventInput,
} from "@everr/telemetry-explorer/events";
import { insertAdminRows } from "@/lib/clickhouse";

// Cloud backend of the generic log-event emitter (ADR 0004): app-emitted
// events are plain log rows inserted into the OTLP staging table, where
// app.logs_mv projects them into app.logs and derives tenant_id from the
// everr.tenant.id resource attribute, exactly like ingested telemetry.
const OTEL_LOGS_TABLE = "otel.otel_logs";

interface OtelLogRow {
  Timestamp: string;
  TraceId: string;
  SpanId: string;
  SeverityText: string;
  SeverityNumber: number;
  ServiceName: string;
  Body: string;
  ResourceAttributes: Record<string, string>;
  LogAttributes: Record<string, string>;
}

export function createCloudLogEventEmitter(options: {
  tenantId: string;
}): LogEventEmitter {
  const { tenantId } = options;
  if (!tenantId) throw new Error("Missing tenant for log-event emitter");

  return {
    emit: async (event: LogEventInput) => {
      const row: OtelLogRow = {
        Timestamp: new Date().toISOString(),
        TraceId: "",
        SpanId: "",
        SeverityText: event.severityText ?? "INFO",
        SeverityNumber: event.severityNumber ?? 9,
        ServiceName: event.serviceName,
        Body: event.body,
        ResourceAttributes: {
          "service.name": event.serviceName,
          ...event.resourceAttributes,
          // Stamped last: no event can override the tenant it lands in.
          "everr.tenant.id": tenantId,
        },
        LogAttributes: event.attributes,
      };
      await insertAdminRows(OTEL_LOGS_TABLE, [row], {
        date_time_input_format: "best_effort",
      });
    },
  };
}
