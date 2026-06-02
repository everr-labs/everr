import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetryMocks = vi.hoisted(() => {
  return {
    emit: vi.fn(),
    getLogger: vi.fn(() => ({ emit: vi.fn() })),
  };
});

vi.mock("@opentelemetry/api-logs", () => ({
  logs: {
    getLogger: telemetryMocks.getLogger,
  },
  SeverityNumber: {
    DEBUG: 5,
    ERROR: 17,
    INFO: 9,
    WARN: 13,
  },
}));

vi.mock("@opentelemetry/api", () => ({
  context: {
    active: vi.fn(() => "active-context"),
  },
}));

import { createTelemetryLogger, exceptionAttributes } from "./logger";

describe("createTelemetryLogger", () => {
  beforeEach(() => {
    telemetryMocks.emit.mockClear();
    telemetryMocks.getLogger.mockClear();
    telemetryMocks.getLogger.mockReturnValue({ emit: telemetryMocks.emit });
  });

  it("emits structured info logs with scalar attributes", () => {
    const logger = createTelemetryLogger("everr-app.test");

    logger.info("github.installation.status_updated", {
      "github.installation.id": 123,
      "github.installation.status": "active",
    });

    expect(telemetryMocks.getLogger).toHaveBeenCalledWith("everr-app.test");
    expect(telemetryMocks.emit).toHaveBeenCalledWith({
      attributes: {
        "github.installation.id": 123,
        "github.installation.status": "active",
      },
      body: "github.installation.status_updated",
      context: "active-context",
      severityNumber: 9,
      severityText: "INFO",
    });
  });

  it("sets log record context without overriding caller attributes", () => {
    const logger = createTelemetryLogger("everr-app.test");

    logger.warn("github.api.rate_limited", {
      "http.response.status_code": 403,
      span_id: "caller-span",
      trace_id: "caller-trace",
    });

    expect(telemetryMocks.emit).toHaveBeenCalledWith({
      attributes: {
        "http.response.status_code": 403,
        span_id: "caller-span",
        trace_id: "caller-trace",
      },
      body: "github.api.rate_limited",
      context: "active-context",
      severityNumber: 13,
      severityText: "WARN",
    });
  });

  it("serializes Error values into exception attributes", () => {
    const error = new Error("database unavailable");
    error.stack = "Error: database unavailable\n    at test";
    const logger = createTelemetryLogger("everr-app.test");

    logger.error("notify.pg_notify.failed", {
      ...exceptionAttributes(error),
      "messaging.system": "postgresql",
    });

    expect(telemetryMocks.emit).toHaveBeenCalledWith({
      attributes: {
        "exception.message": "database unavailable",
        "exception.stacktrace": "Error: database unavailable\n    at test",
        "exception.type": "Error",
        "messaging.system": "postgresql",
      },
      body: "notify.pg_notify.failed",
      context: "active-context",
      severityNumber: 17,
      severityText: "ERROR",
    });
  });
});
