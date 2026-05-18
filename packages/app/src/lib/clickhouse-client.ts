import {
  type ClickHouseClient,
  type ClickHouseClientConfigOptions,
  createClient as upstreamCreateClient,
} from "@clickhouse/client";
import { type Span, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("@everr/app/clickhouse");

type SqlMethod = "query" | "command" | "exec";
type AnyParams = Record<string, unknown>;
type AnyAsync = (params: AnyParams) => Promise<unknown>;

export function createClient(
  config: ClickHouseClientConfigOptions,
): ClickHouseClient {
  const client = upstreamCreateClient(config);
  const database = config.database ?? "default";

  const wrapped: Record<string, AnyAsync> = {
    query: instrumentSql(client, "query", database),
    command: instrumentSql(client, "command", database),
    exec: instrumentSql(client, "exec", database),
    insert: instrumentInsert(client, database),
  };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop in wrapped) {
        return wrapped[prop];
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function instrumentSql(
  client: ClickHouseClient,
  method: SqlMethod,
  database: string,
): AnyAsync {
  const original = (client[method] as unknown as AnyAsync).bind(client);
  return (params) => {
    const sql = typeof params?.query === "string" ? params.query : "";
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
      (span) => runInSpan(span, () => original(params)),
    );
  };
}

function instrumentInsert(
  client: ClickHouseClient,
  database: string,
): AnyAsync {
  const original = (client.insert as unknown as AnyAsync).bind(client);
  return (params) => {
    const table = typeof params?.table === "string" ? params.table : "unknown";
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
      (span) => runInSpan(span, () => original(params)),
    );
  };
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
