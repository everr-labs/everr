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

  // fallow-ignore-next-line unused-class-member
  async search(input: SearchTracesInput): Promise<TraceSummary[]> {
    // Row-level predicates push down to WHERE in a candidate subquery so the
    // outer aggregate only reads spans belonging to traces with at least one
    // matching span. Without this, span-level HAVING via countIf forces a
    // full in-window scan + group-by on every tenant span.
    const spanPreds: string[] = [];
    // Aggregate-level predicates that can't be pushed to WHERE.
    const havingParts: string[] = [];
    const params: Record<string, unknown> = {
      fromTs: input.fromTs,
      toTs: input.toTs,
      limit: input.limit,
    };

    if (input.name) {
      spanPreds.push("positionCaseInsensitive(SpanName, {name:String}) > 0");
      params.name = input.name;
    }
    if (input.service.length > 0) {
      spanPreds.push("ServiceName IN {service:Array(String)}");
      params.service = input.service;
    }
    if (input.namespace.length > 0) {
      spanPreds.push(
        "ResourceAttributes['service.namespace'] IN {namespace:Array(String)}",
      );
      params.namespace = input.namespace;
    }
    // durationNsRaw is the inner-aggregate alias (UInt64); the outer query
    // exposes it as a string. Filter on the raw int to avoid a double
    // toString → toUInt64 round-trip per row.
    if (input.minDurationNs !== undefined) {
      havingParts.push("durationNsRaw >= {minDurationNs:UInt64}");
      params.minDurationNs = input.minDurationNs;
    }
    if (input.maxDurationNs !== undefined) {
      havingParts.push("durationNsRaw <= {maxDurationNs:UInt64}");
      params.maxDurationNs = input.maxDurationNs;
    }
    // Span-level, matching the rest of the filters: 'error' = trace contains
    // at least one Error span; 'ok' = trace contains zero Error spans (Ok or
    // Unset everywhere). Filtering on the root span alone hides traces whose
    // failure lives in a child.
    if (input.status === "error") {
      havingParts.push("countIf(StatusCode = 'Error') > 0");
    } else if (input.status === "ok") {
      havingParts.push("countIf(StatusCode = 'Error') = 0");
    }

    // Two-pass when span-level filters are present: the inner subquery uses
    // WHERE to prune spans before reading, then the outer aggregates the full
    // trace (every in-window span) for matching trace ids. Without span
    // filters, single-pass over the time window is cheapest.
    // Root election: argMinIf returns the column default ('') when no row
    // matches, not NULL — gate on countIf(ParentSpanId = '') > 0.
    const candidateFilter =
      spanPreds.length > 0
        ? `AND TraceId IN (
            SELECT DISTINCT TraceId
            FROM app.traces
            WHERE Timestamp BETWEEN {fromTs:DateTime64(9)} AND {toTs:DateTime64(9)}
              AND ${spanPreds.join(" AND ")}
          )`
        : "";

    const sql = /* sql */ `
      WITH aggregated AS (
        SELECT
          TraceId,
          if(countIf(ParentSpanId = '') > 0,
             argMinIf(SpanName,    (Timestamp, SpanId), ParentSpanId = ''),
             argMin  (SpanName,    (Timestamp, SpanId))) AS rootName,
          if(countIf(ParentSpanId = '') > 0,
             argMinIf(ServiceName, (Timestamp, SpanId), ParentSpanId = ''),
             argMin  (ServiceName, (Timestamp, SpanId))) AS rootService,
          if(countIf(ParentSpanId = '') > 0,
             argMinIf(ResourceAttributes['service.namespace'], (Timestamp, SpanId), ParentSpanId = ''),
             argMin  (ResourceAttributes['service.namespace'], (Timestamp, SpanId))) AS rootNamespace,
          if(countIf(ParentSpanId = '') > 0,
             argMinIf(StatusCode,  (Timestamp, SpanId), ParentSpanId = ''),
             argMin  (StatusCode,  (Timestamp, SpanId))) AS rootStatus,
          min(Timestamp) AS startTsRaw,
          toUInt64(dateDiff('nanosecond', min(Timestamp),
                            max(addNanoseconds(Timestamp, Duration)))) AS durationNsRaw,
          toUInt32(count())                       AS spanCount,
          toUInt32(countIf(StatusCode = 'Error')) AS errorCount,
          groupUniqArray(ServiceName)             AS services
        FROM app.traces
        WHERE Timestamp BETWEEN {fromTs:DateTime64(9)} AND {toTs:DateTime64(9)}
          ${candidateFilter}
        GROUP BY TraceId
        ${havingParts.length > 0 ? `HAVING ${havingParts.join(" AND ")}` : ""}
        ORDER BY startTsRaw DESC
        LIMIT {limit:UInt32}
      )
      SELECT
        TraceId             AS traceId,
        rootName,
        rootService,
        rootNamespace,
        rootStatus,
        toString(startTsRaw)    AS startTs,
        toString(durationNsRaw) AS durationNs,
        spanCount,
        errorCount,
        services
      FROM aggregated
    `;
    return this.query<TraceSummary>(sql, params);
  }

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
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
