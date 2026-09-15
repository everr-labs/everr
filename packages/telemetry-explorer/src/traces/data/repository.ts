import type {
  AttributeKey,
  AttributeKeysInput,
  AttributeValuesInput,
} from "../../attribute-filter/schemas";
import {
  type AttributeKeyRowRaw,
  buildAttributeKeysQuery,
  decodeAttributeKeyRows,
} from "../../attribute-filter/sql/keys";
import {
  type AttributeValueRowRaw,
  buildAttributeValuesQuery,
  decodeAttributeValueRows,
} from "../../attribute-filter/sql/values";
import { buildAttributeClauses } from "../../attribute-filter/sql/where";
import {
  attributeText,
  flattenAttributes,
  type JsonAttributes,
} from "../../sql/json-attributes";
import {
  resourceAttribute,
  resourceAttributeKeyExists,
} from "../../sql/resource-attributes";
import {
  TRACES_ATTRIBUTE_SOURCES,
  tracesAttributeColumn,
} from "../sql/attribute-columns";
import { validateTableName } from "../sql/table";
import type { SqlClient } from "./client";
import type {
  GetTraceInput,
  ListServiceIdentitiesInput,
  SearchTracesInput,
} from "./schemas";
import type { ServiceIdentity, Span, TraceSummary } from "./types";

type SpanRow = Omit<
  Span,
  "events" | "links" | "spanAttributes" | "resourceAttributes"
> & {
  spanAttributes: JsonAttributes;
  resourceAttributes: JsonAttributes;
  eventNames: string[];
  eventTimestamps: string[];
  eventAttributes: JsonAttributes[];
  linkTraceIds: string[];
  linkSpanIds: string[];
  linkAttributes: JsonAttributes[];
};

const FROM_TS_SQL = "parseDateTime64BestEffort({fromTs:String}, 9)";
const TO_TS_SQL = "parseDateTime64BestEffort({toTs:String}, 9)";
const TIME_WINDOW_SQL = `Timestamp BETWEEN ${FROM_TS_SQL} AND ${TO_TS_SQL}`;
const TRACE_DURATION_SQL = `toUInt64(dateDiff('nanosecond', min(Timestamp),
                            max(addNanoseconds(Timestamp, Duration))))`;
const SERVICE_NAMESPACE_RESOURCE_ATTRIBUTE = "service.namespace";

// The HTTP status code of the root span. `http.response.status_code` is the
// stable OpenTelemetry attribute. `http.status_code` is the name before version
// 1.23 that some SDKs still send.
//
// toString of a missing path is '' in ClickHouse, the same as a key absent
// from a Map. The second choice is therefore a test for an empty string, and
// no test for null is necessary. A span that is not an HTTP span gives ''.
const ROOT_HTTP_STATUS_CODE_SQL = `if(
  ${attributeText("SpanAttributes", "http.response.status_code")} != '',
  ${attributeText("SpanAttributes", "http.response.status_code")},
  ${attributeText("SpanAttributes", "http.status_code")}
)`;

// Prefer the earliest root span, falling back to the earliest available span.
// argMinIf returns a default value when no root exists, so test the root count.
function rootSpanValueSql(expression: string): string {
  return `if(countIf(ParentSpanId = '') > 0,
    argMinIf(${expression}, (Timestamp, SpanId), ParentSpanId = ''),
    argMin(${expression}, (Timestamp, SpanId)))`;
}

// Traces store Timestamp as DateTime64(9); attribute discovery must parse its
// bounds the same way the search queries do, or sub-second rows near the upper
// bound get dropped and the offered keys/values disagree with the results.
const tracesTimeBound = (param: string) =>
  `parseDateTime64BestEffort({${param}:String}, 9)`;

export class TracesRepository {
  private readonly tableName: string;

  constructor(
    private readonly client: SqlClient,
    options: TracesRepositoryOptions = {},
  ) {
    this.tableName = options.tableName ?? "traces";
  }

  async search(input: SearchTracesInput): Promise<TraceSummary[]> {
    validateTableName(this.tableName);
    // Row-level predicates push down to WHERE in a candidate subquery so
    // page selection only reads spans belonging to traces with at least one
    // matching span. Without this, span-level HAVING via countIf forces a
    // full in-window scan + group-by on every tenant span.
    const spanPreds: string[] = [];
    const havingParts: string[] = [];
    const hasCursor = Boolean(input.cursorStartTs && input.cursorTraceId);
    const params: Record<string, unknown> = {
      fromTs: input.fromTs,
      toTs: hasCursor ? input.cursorStartTs : input.toTs,
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
      const namespaceFilter = `${resourceAttribute(SERVICE_NAMESPACE_RESOURCE_ATTRIBUTE)} IN {namespace:Array(String)}`;
      spanPreds.push(
        input.namespace.includes("")
          ? namespaceFilter
          : `${resourceAttributeKeyExists(SERVICE_NAMESPACE_RESOURCE_ATTRIBUTE)} AND ${namespaceFilter}`,
      );
      params.namespace = input.namespace;
    }
    // Positive operators (in/exists) keep the "any-span match" semantics of the
    // candidate subquery: a trace qualifies if one of its spans carries the
    // attribute. Negative operators (not_in/missing) cannot: a trace would
    // match `missing http.route` merely because its DB span lacks the key, even
    // though its server span has it. Evaluate those at the trace level instead,
    // as the complement — exclude every trace that has *any* span satisfying the
    // positive sense (in ↔ not_in, exists ↔ missing).
    const attributes = input.attributes ?? [];
    const attr = buildAttributeClauses(
      attributes.filter((f) => f.op === "in" || f.op === "exists"),
      tracesAttributeColumn,
    );
    spanPreds.push(...attr.clauses);
    Object.assign(params, attr.params);

    const pageWhereParts = [TIME_WINDOW_SQL];
    // A matching child span qualifies its trace. Keep every in-window span of
    // that trace when evaluating duration, status, and the pagination cursor.
    if (spanPreds.length > 0) {
      pageWhereParts.push(`TraceId IN (
        SELECT DISTINCT TraceId
        FROM ${this.tableName}
        WHERE ${TIME_WINDOW_SQL}
          AND ${spanPreds.join(" AND ")}
      )`);
    }

    attributes
      .filter((f) => f.op === "not_in" || f.op === "missing")
      .forEach((filter, i) => {
        const positiveSense =
          filter.op === "not_in"
            ? { ...filter, op: "in" as const }
            : { ...filter, op: "exists" as const };
        // Param namespace disjoint from the positive clauses above.
        const built = buildAttributeClauses(
          [positiveSense],
          tracesAttributeColumn,
          attributes.length + i,
        );
        // `not_in` with no values is a no-op, matching buildAttributeClauses.
        if (built.clauses.length === 0) return;
        pageWhereParts.push(
          `TraceId NOT IN (
            SELECT DISTINCT TraceId
            FROM ${this.tableName}
            WHERE ${TIME_WINDOW_SQL}
              AND ${built.clauses.join(" AND ")}
          )`,
        );
        Object.assign(params, built.params);
      });

    // durationNsRaw is an aggregate alias (UInt64); the outer query
    // exposes it as a string. Filter on the raw int to avoid a double
    // toString → toUInt64 round-trip per row.
    if (input.minDurationNs !== undefined) {
      havingParts.push("durationNsRaw >= toUInt64({minDurationNs:String})");
      params.minDurationNs = input.minDurationNs;
    }
    if (input.maxDurationNs !== undefined) {
      havingParts.push("durationNsRaw <= toUInt64({maxDurationNs:String})");
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

    if (hasCursor) {
      havingParts.push(`(
            startTsRaw < parseDateTime64BestEffort({cursorStartTs:String}, 9)
            OR (
              startTsRaw = parseDateTime64BestEffort({cursorStartTs:String}, 9)
              AND TraceId < {cursorTraceId:String}
            )
          )`);
      params.cursorStartTs = input.cursorStartTs;
      params.cursorTraceId = input.cursorTraceId;
    }

    // Select the page using only the columns needed for ordering and filters.
    // Root election, JSON attribute reads, and service lists are then computed
    // for this page instead of every trace in the selected time window.
    const pageColumns = ["TraceId", "min(Timestamp) AS startTsRaw"];
    if (
      input.minDurationNs !== undefined ||
      input.maxDurationNs !== undefined
    ) {
      pageColumns.push(`${TRACE_DURATION_SQL} AS durationNsRaw`);
    }

    const sql = /* sql */ `
      WITH page AS (
        SELECT ${pageColumns.join(",\n          ")}
        FROM ${this.tableName}
        WHERE ${pageWhereParts.join("\n          AND ")}
        GROUP BY TraceId
        ${havingParts.length > 0 ? `HAVING ${havingParts.join(" AND ")}` : ""}
        ORDER BY startTsRaw DESC, TraceId DESC
        LIMIT {limit:UInt32}
      ), aggregated AS (
        SELECT
          TraceId,
          ${rootSpanValueSql("SpanName")} AS rootName,
          ${rootSpanValueSql("ServiceName")} AS rootService,
          ${rootSpanValueSql(resourceAttribute(SERVICE_NAMESPACE_RESOURCE_ATTRIBUTE))} AS rootNamespace,
          ${rootSpanValueSql("StatusCode")} AS rootStatus,
          ${rootSpanValueSql(ROOT_HTTP_STATUS_CODE_SQL)} AS rootStatusCode,
          min(Timestamp) AS startTsRaw,
          ${TRACE_DURATION_SQL} AS durationNsRaw,
          toUInt32(count())                       AS spanCount,
          toUInt32(countIf(StatusCode = 'Error')) AS errorCount,
          groupUniqArray(ServiceName)             AS services
        FROM ${this.tableName}
        WHERE ${TIME_WINDOW_SQL}
          AND TraceId IN (SELECT TraceId FROM page)
        GROUP BY TraceId
      )
      SELECT
        TraceId             AS traceId,
        rootName,
        rootService,
        rootNamespace,
        rootStatus,
        rootStatusCode,
        toString(startTsRaw)    AS startTs,
        toString(durationNsRaw) AS durationNs,
        spanCount,
        errorCount,
        services
      FROM aggregated
      ORDER BY startTsRaw DESC, TraceId DESC
    `;
    return this.client.execute<TraceSummary>(sql, params);
  }

  // fallow-ignore-next-line unused-class-member
  async getTrace(input: GetTraceInput): Promise<Span[]> {
    validateTableName(this.tableName);
    // TraceId is not a sort-key prefix; the time window limits the scan.
    const sql = /* sql */ `
      SELECT
        TraceId      AS traceId,
        SpanId       AS spanId,
        ParentSpanId AS parentSpanId,
        SpanName     AS spanName,
        ServiceName  AS serviceName,
        ${resourceAttribute(SERVICE_NAMESPACE_RESOURCE_ATTRIBUTE)} AS serviceNamespace,
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
      FROM ${this.tableName}
      WHERE TraceId = {traceId:String}
        AND ${TIME_WINDOW_SQL}
      ORDER BY Timestamp ASC
    `;
    const rows = await this.client.execute<SpanRow>(sql, {
      traceId: input.traceId,
      fromTs: input.fromTs,
      toTs: input.toTs,
    });
    return rows.map(rowToSpan);
  }

  // fallow-ignore-next-line unused-class-member
  async attributeKeys(input: AttributeKeysInput): Promise<AttributeKey[]> {
    validateTableName(this.tableName);
    const { sql, params } = buildAttributeKeysQuery(input, {
      tableName: this.tableName,
      sources: TRACES_ATTRIBUTE_SOURCES,
      columnFor: tracesAttributeColumn,
      timeColumn: "Timestamp",
      timeBound: tracesTimeBound,
    });
    const rows = await this.client.execute<AttributeKeyRowRaw>(sql, params);
    return decodeAttributeKeyRows(rows);
  }

  // fallow-ignore-next-line unused-class-member
  async attributeValues(input: AttributeValuesInput): Promise<string[]> {
    validateTableName(this.tableName);
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
      columnFor: tracesAttributeColumn,
      timeColumn: "Timestamp",
      timeBound: tracesTimeBound,
    });
    const rows = await this.client.execute<AttributeValueRowRaw>(sql, params);
    return decodeAttributeValueRows(rows);
  }

  // fallow-ignore-next-line unused-class-member
  async listServiceIdentities(
    input: ListServiceIdentitiesInput,
  ): Promise<ServiceIdentity[]> {
    validateTableName(this.tableName);
    const sql = /* sql */ `
      SELECT DISTINCT
        ${resourceAttribute(SERVICE_NAMESPACE_RESOURCE_ATTRIBUTE)} AS serviceNamespace,
        ServiceName AS serviceName
      FROM ${this.tableName}
      WHERE ${TIME_WINDOW_SQL}
      ORDER BY serviceNamespace, serviceName
    `;
    return this.client.execute<ServiceIdentity>(sql, {
      fromTs: input.fromTs,
      toTs: input.toTs,
    });
  }
}

export interface TracesRepositoryOptions {
  tableName?: string;
}

export type TracesRepositoryLike = Pick<
  TracesRepository,
  | "search"
  | "getTrace"
  | "listServiceIdentities"
  | "attributeKeys"
  | "attributeValues"
>;

function rowToSpan(row: SpanRow): Span {
  const {
    spanAttributes,
    resourceAttributes,
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
    spanAttributes: flattenAttributes(spanAttributes),
    resourceAttributes: flattenAttributes(resourceAttributes),
    events: eventNames.map((name, i) => ({
      name,
      timestamp: eventTimestamps[i] ?? "",
      attributes: flattenAttributes(eventAttributes[i]),
    })),
    links: linkTraceIds.map((traceId, i) => ({
      traceId,
      spanId: linkSpanIds[i] ?? "",
      attributes: flattenAttributes(linkAttributes[i]),
    })),
  };
}
