import { attributeText } from "@everr/telemetry-explorer/sql";
import {
  GetTraceInputSchema,
  ListServiceIdentitiesInputSchema,
  SearchTracesInputSchema,
  type SqlClient,
  TraceAttributeKeysInputSchema,
  TraceAttributeValuesInputSchema,
  type TraceLogMarker,
  TracesRepository,
} from "@everr/telemetry-explorer/traces";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new TracesRepository(client);
}

const EXCEPTION_TYPE = attributeText("LogAttributes", "exception.type");
const EXCEPTION_MESSAGE = attributeText("LogAttributes", "exception.message");

type TraceLogRow = {
  spanId: string;
  timestamp: string;
  timestampNs: string;
  severityNumber: string | number;
  severityText: string;
  body: string;
  eventName: string;
  exceptionType: string;
  exceptionMessage: string;
};

// One read for the whole Trace. The time window comes from
// traces_trace_id_ts, because logs and traces are not sorted by TraceId, and
// traces_trace_id_ts is the small table that knows a Trace's range. `logs` has
// a bloom filter on TraceId. A Log with no SpanId cannot sit on a waterfall
// row, so the query leaves those out.
const TRACE_LOGS_SQL = `
  SELECT
    SpanId AS spanId,
    toString(Timestamp) AS timestamp,
    toString(toUnixTimestamp64Nano(Timestamp)) AS timestampNs,
    SeverityNumber AS severityNumber,
    SeverityText AS severityText,
    Body AS body,
    EventName AS eventName,
    ${EXCEPTION_TYPE} AS exceptionType,
    ${EXCEPTION_MESSAGE} AS exceptionMessage
  FROM logs
  WHERE TraceId = {traceId:String}
    AND Timestamp >= (SELECT min(Start) FROM traces_trace_id_ts WHERE TraceId = {traceId:String})
    AND Timestamp < (SELECT max(End) + 1 FROM traces_trace_id_ts WHERE TraceId = {traceId:String})
    AND SpanId != ''
  ORDER BY Timestamp ASC
`;

const TraceLogsInputSchema = z.object({
  traceId: z.string().min(1),
});

function isErrorLog(row: TraceLogRow): boolean {
  const hasException = row.exceptionType !== "" || row.exceptionMessage !== "";
  return Number(row.severityNumber) >= 17 && hasException;
}

async function loadTraceLogs(
  clickhouse: {
    query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
  },
  traceId: string,
): Promise<TraceLogMarker[]> {
  const rows = await clickhouse.query<TraceLogRow>(TRACE_LOGS_SQL, {
    traceId,
  });
  return rows.map((row) => ({
    spanId: row.spanId,
    timestamp: row.timestamp,
    timestampNs: row.timestampNs,
    severityNumber: Number(row.severityNumber),
    severityText: row.severityText,
    body: row.body,
    eventName: row.eventName,
    isError: isErrorLog(row),
  }));
}

export const getTraceLogs = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(TraceLogsInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    loadTraceLogs(clickhouse, data.traceId),
  );

export const searchTraces = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(SearchTracesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).search(data),
  );

export const getTrace = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(GetTraceInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).getTrace(data),
  );

export const listServiceIdentities = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(ListServiceIdentitiesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).listServiceIdentities(data),
  );

export const getTraceAttributeKeys = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TraceAttributeKeysInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeKeys(data),
  );

export const getTraceAttributeValues = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TraceAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );
