import type { Attributes } from "@opentelemetry/api";
import { getTelemetryTracer, recordTelemetryError, SpanKind } from "./node";

type ClickhouseClient = "admin" | "app" | "sql_api";

export type ClickhouseOperationAttributes = {
  client: ClickhouseClient;
  operation: string;
};

const tracer = getTelemetryTracer("everr-app.clickhouse");

export async function instrumentClickhouseOperation<T>(
  attributes: ClickhouseOperationAttributes,
  run: () => Promise<T>,
) {
  const spanAttributes = clickhouseAttributes(attributes);

  return tracer.startActiveSpan(
    `ClickHouse ${attributes.operation}`,
    {
      attributes: spanAttributes,
      kind: SpanKind.CLIENT,
    },
    async (span) => {
      try {
        return await run();
      } catch (error) {
        recordTelemetryError(error, {
          ...spanAttributes,
          "error.handled": false,
          "error.source": "clickhouse",
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function clickhouseOperationFromSql(sql: string) {
  const operation = /^\s*([a-z]+)/i.exec(sql)?.[1]?.toUpperCase();
  return operation && knownOperations.has(operation) ? operation : "QUERY";
}

function clickhouseAttributes({
  client,
  operation,
}: ClickhouseOperationAttributes): Attributes {
  return {
    "clickhouse.client": client,
    "db.operation.name": operation,
    "db.system.name": "clickhouse",
  };
}

const knownOperations = new Set([
  "ALTER",
  "CREATE",
  "DELETE",
  "DROP",
  "GRANT",
  "INSERT",
  "OPTIMIZE",
  "SELECT",
  "SET",
]);
