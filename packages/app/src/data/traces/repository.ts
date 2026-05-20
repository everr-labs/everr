import type {
  GetTraceInput,
  ListServiceIdentitiesInput,
  SearchTracesInput,
} from "./schemas";
import type { ServiceIdentity, Span, TraceSummary } from "./types";

type Query = <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;

type SpanRow = Omit<Span, "events" | "links"> & {
  eventNames: string[];
  eventTimestamps: string[];
  eventAttributes: Record<string, string>[];
  linkTraceIds: string[];
  linkSpanIds: string[];
  linkAttributes: Record<string, string>[];
};

export class TracesRepository {
  constructor(private readonly query: Query) {}

  async search(input: SearchTracesInput): Promise<TraceSummary[]> {
    const havingParts: string[] = [];
    const params: Record<string, unknown> = {
      fromTs: input.fromTs,
      toTs: input.toTs,
      name: input.name,
      service: input.service,
      namespace: input.namespace,
      limit: input.limit,
    };

    // Build HAVING in JS rather than `'' OR …`: `toUInt64('')` raises in ClickHouse.
    if (input.minDurationNs !== undefined) {
      havingParts.push("toUInt64(durationNs) >= {minDurationNs:UInt64}");
      params.minDurationNs = input.minDurationNs;
    }
    if (input.maxDurationNs !== undefined) {
      havingParts.push("toUInt64(durationNs) <= {maxDurationNs:UInt64}");
      params.maxDurationNs = input.maxDurationNs;
    }
    if (input.status === "ok" || input.status === "error") {
      havingParts.push("rootStatus = {status:String}");
      params.status = input.status === "error" ? "Error" : "Ok";
    }
    const havingClause =
      havingParts.length > 0 ? `HAVING ${havingParts.join(" AND ")}` : "";

    // Root election: `argMinIf` returns the column's default ('') when no row
    // matches the predicate, not NULL — so `coalesce(argMinIf, argMin)` is
    // wrong. Gate explicitly on `countIf(ParentSpanId = '') > 0`.
    const sql = /* sql */ `
      WITH matching_traces AS (
        SELECT TraceId
        FROM app.traces
        WHERE Timestamp BETWEEN {fromTs:DateTime64(9)} AND {toTs:DateTime64(9)}
          AND ({name:String} = '' OR positionCaseInsensitive(SpanName, {name:String}) > 0)
          AND (empty({service:Array(String)}) OR ServiceName IN {service:Array(String)})
          AND (empty({namespace:Array(String)})
               OR ResourceAttributes['service.namespace'] IN {namespace:Array(String)})
        GROUP BY TraceId
        ORDER BY max(Timestamp) DESC
        LIMIT 1000
      )
      SELECT
        TraceId AS traceId,
        if(countIf(ParentSpanId = '') > 0,
           argMinIf(SpanName,    (Timestamp, SpanId), ParentSpanId = ''),
           argMin  (SpanName,    (Timestamp, SpanId))) AS rootName,
        if(countIf(ParentSpanId = '') > 0,
           argMinIf(ServiceName, (Timestamp, SpanId), ParentSpanId = ''),
           argMin  (ServiceName, (Timestamp, SpanId))) AS rootService,
        if(countIf(ParentSpanId = '') > 0,
           argMinIf(StatusCode,  (Timestamp, SpanId), ParentSpanId = ''),
           argMin  (StatusCode,  (Timestamp, SpanId))) AS rootStatus,
        toString(min(Timestamp)) AS startTs,
        toString(
          toUInt64(dateDiff('nanosecond', min(Timestamp),
                            max(addNanoseconds(Timestamp, Duration))))
        ) AS durationNs,
        toUInt32(count())                       AS spanCount,
        toUInt32(countIf(StatusCode = 'Error')) AS errorCount,
        groupUniqArray(ServiceName)             AS services
      FROM app.traces
      WHERE TraceId IN (SELECT TraceId FROM matching_traces)
      GROUP BY TraceId
      ${havingClause}
      ORDER BY startTs DESC
      LIMIT {limit:UInt32}
    `;
    return this.query<TraceSummary>(sql, params);
  }

  async getTrace(input: GetTraceInput): Promise<Span[]> {
    // The order key on `app.traces` is (tenant_id, ServiceName, SpanName,
    // toDateTime(Timestamp)) — a bare `TraceId =` is bloom-filter-only and
    // scans broadly. The Timestamp BETWEEN predicate lets parts prune.
    const sql = /* sql */ `
      SELECT
        TraceId      AS traceId,
        SpanId       AS spanId,
        ParentSpanId AS parentSpanId,
        SpanName     AS spanName,
        ServiceName  AS serviceName,
        ResourceAttributes['service.namespace'] AS serviceNamespace,
        toString(Timestamp)                     AS timestamp,
        toString(toUnixTimestamp64Nano(Timestamp)) AS timestampNs,
        toString(Duration)                      AS duration,
        StatusCode AS statusCode,
        SpanKind   AS spanKind,
        SpanAttributes     AS spanAttributes,
        ResourceAttributes AS resourceAttributes,
        Events.Name       AS eventNames,
        arrayMap(t -> toString(t), Events.Timestamp) AS eventTimestamps,
        Events.Attributes AS eventAttributes,
        Links.TraceId     AS linkTraceIds,
        Links.SpanId      AS linkSpanIds,
        Links.Attributes  AS linkAttributes
      FROM app.traces
      WHERE TraceId = {traceId:String}
        AND Timestamp BETWEEN {fromTs:DateTime64(9)} AND {toTs:DateTime64(9)}
      ORDER BY Timestamp ASC
    `;
    const rows = await this.query<SpanRow>(sql, {
      traceId: input.traceId,
      fromTs: input.fromTs,
      toTs: input.toTs,
    });
    return rows.map(rowToSpan);
  }

  async listServiceIdentities(
    input: ListServiceIdentitiesInput,
  ): Promise<ServiceIdentity[]> {
    const sql = /* sql */ `
      SELECT DISTINCT
        ResourceAttributes['service.namespace'] AS serviceNamespace,
        ServiceName AS serviceName
      FROM app.traces
      WHERE Timestamp BETWEEN {fromTs:DateTime64(9)} AND {toTs:DateTime64(9)}
      ORDER BY serviceNamespace, serviceName
    `;
    return this.query<ServiceIdentity>(sql, {
      fromTs: input.fromTs,
      toTs: input.toTs,
    });
  }
}

function rowToSpan(row: SpanRow): Span {
  const {
    eventNames,
    eventTimestamps,
    eventAttributes,
    linkTraceIds,
    linkSpanIds,
    linkAttributes,
    ...rest
  } = row;
  return {
    ...rest,
    events: eventNames.map((name, i) => ({
      name,
      timestamp: eventTimestamps[i] ?? "",
      attributes: eventAttributes[i] ?? {},
    })),
    links: linkTraceIds.map((traceId, i) => ({
      traceId,
      spanId: linkSpanIds[i] ?? "",
      attributes: linkAttributes[i] ?? {},
    })),
  };
}
