import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetryMocks = vi.hoisted(() => {
  const span = {
    end: vi.fn(),
  };

  return {
    captureError: vi.fn(),
    loggerInfo: vi.fn(),
    span,
    startActiveSpan: vi.fn(
      async (
        _name: string,
        _options: unknown,
        run: (span: { end: () => void }) => Promise<unknown>,
      ) => run(span),
    ),
  };
});

vi.mock("./node", () => ({
  captureError: telemetryMocks.captureError,
  getTelemetryTracer: () => ({
    startActiveSpan: telemetryMocks.startActiveSpan,
  }),
  SpanKind: { CLIENT: 2 },
}));

vi.mock("./logger", () => ({
  createTelemetryLogger: () => ({ info: telemetryMocks.loggerInfo }),
  exceptionAttributes: (error: unknown) => ({
    "exception.message": error instanceof Error ? error.message : String(error),
    "exception.type": error instanceof Error ? error.name : "Error",
  }),
}));

import { instrumentClickhouseOperation } from "./clickhouse";

describe("instrumentClickhouseOperation", () => {
  beforeEach(() => {
    telemetryMocks.captureError.mockClear();
    telemetryMocks.loggerInfo.mockClear();
    telemetryMocks.span.end.mockClear();
    telemetryMocks.startActiveSpan.mockClear();
  });

  it("records unexpected app ClickHouse errors", async () => {
    const error = new Error("database unavailable");

    await expect(
      instrumentClickhouseOperation(
        { client: "app", operation: "QUERY" },
        async () => {
          throw error;
        },
      ),
    ).rejects.toThrow("database unavailable");

    expect(telemetryMocks.captureError).toHaveBeenCalledWith(error, {
      "clickhouse.client": "app",
      "db.operation.name": "QUERY",
      "db.system.name": "clickhouse",
      "everr.error.source": "clickhouse",
    });
    expect(telemetryMocks.loggerInfo).not.toHaveBeenCalled();
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it("emits expected SQL API query errors as info instead of recording them", async () => {
    const error = Object.assign(
      new Error("Unknown table expression identifier 'alert_eventss'"),
      { code: "60", type: "UNKNOWN_TABLE" },
    );

    await expect(
      instrumentClickhouseOperation(
        { client: "sql_api", operation: "QUERY" },
        async () => {
          throw error;
        },
      ),
    ).rejects.toThrow("Unknown table");

    expect(telemetryMocks.captureError).not.toHaveBeenCalled();
    expect(telemetryMocks.loggerInfo).toHaveBeenCalledWith(
      "Expected ClickHouse SQL API query error",
      {
        "clickhouse.client": "sql_api",
        "db.operation.name": "QUERY",
        "db.system.name": "clickhouse",
        "exception.message":
          "Unknown table expression identifier 'alert_eventss'",
        "exception.type": "Error",
      },
    );
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it("still records unexpected SQL API infrastructure errors", async () => {
    const error = new Error("connection refused");

    await expect(
      instrumentClickhouseOperation(
        { client: "sql_api", operation: "QUERY" },
        async () => {
          throw error;
        },
      ),
    ).rejects.toThrow("connection refused");

    expect(telemetryMocks.captureError).toHaveBeenCalledWith(error, {
      "clickhouse.client": "sql_api",
      "db.operation.name": "QUERY",
      "db.system.name": "clickhouse",
      "everr.error.source": "clickhouse",
    });
    expect(telemetryMocks.loggerInfo).not.toHaveBeenCalled();
  });
});
