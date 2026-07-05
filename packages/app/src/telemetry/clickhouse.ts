import type { Attributes } from "@opentelemetry/api";
import { isExpectedSqlApiQueryError } from "./expected-errors";
import { createTelemetryLogger, exceptionAttributes } from "./logger";
import { captureError, getTelemetryTracer, SpanKind } from "./node";

type ClickhouseClient = "admin" | "app" | "sql_api";

export type ClickhouseOperationAttributes = {
  client: ClickhouseClient;
  operation: string;
};

const tracer = getTelemetryTracer("everr-app.clickhouse");
const logger = createTelemetryLogger("everr-app.clickhouse");

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
        if (isExpectedSqlApiQueryError(attributes, error)) {
          // Expected SQL API errors (bad user SQL, quota, etc.) are not bugs, so
          // they don't get captured as errors — but still emit them at info so
          // they remain visible in telemetry instead of vanishing.
          logger.info("Expected ClickHouse SQL API query error", {
            ...spanAttributes,
            ...exceptionAttributes(error),
          });
        } else {
          captureError(error, {
            ...spanAttributes,
            "error.handled": false,
            "error.source": "clickhouse",
          });
        }
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

function clickhouseAttributes({ client, operation }: ClickhouseOperationAttributes): Attributes {
  return {
    "clickhouse.client": client,
    "db.operation.name": operation,
    "db.system.name": "clickhouse",
  };
}
