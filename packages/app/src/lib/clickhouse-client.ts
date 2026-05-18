import {
  type ClickHouseClient,
  type ClickHouseClientConfigOptions,
  createClient as upstreamCreateClient,
} from "@clickhouse/client";
import { type Span, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("@everr/app/clickhouse");

type InstrumentedClient = Pick<
  ClickHouseClient,
  "query" | "command" | "insert"
>;

export function createClient(
  config: ClickHouseClientConfigOptions,
): InstrumentedClient {
  const client = upstreamCreateClient(config);
  const database = config.database ?? "default";

  return {
    query: (params) =>
      withSqlSpan("query", database, params.query, () => client.query(params)),
    command: (params) =>
      withSqlSpan("command", database, params.query, () =>
        client.command(params),
      ),
    insert: (params) =>
      withInsertSpan(database, params.table, () => client.insert(params)),
  };
}

function withSqlSpan<T>(
  method: "query" | "command",
  database: string,
  sql: string,
  fn: () => Promise<T>,
): Promise<T> {
  const op = firstSqlKeyword(sql);
  return tracer.startActiveSpan(
    `clickhouse.${method}:${op} ${database}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "db.system": "clickhouse",
        "db.name": database,
        "db.namespace": database,
        "db.operation": op,
        "db.operation.name": op,
        "db.statement": sql,
        "db.query.text": sql,
      },
    },
    (span) => runInSpan(span, fn),
  );
}

function withInsertSpan<T>(
  database: string,
  table: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `clickhouse.insert ${table}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "db.system": "clickhouse",
        "db.name": database,
        "db.namespace": database,
        "db.operation": "INSERT",
        "db.operation.name": "INSERT",
        "db.collection.name": table,
        "db.sql.table": table,
      },
    },
    (span) => runInSpan(span, fn),
  );
}

async function runInSpan<T>(span: Span, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw err;
  } finally {
    span.end();
  }
}

function firstSqlKeyword(sql: string): string {
  const match = sql.trim().match(/^\w+/);
  return match ? match[0].toUpperCase() : "UNKNOWN";
}
