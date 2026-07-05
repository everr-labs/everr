import { describe, expect, it } from "vite-plus/test";
import { resolveTelemetryConfig, signalUrl, telemetryResourceAttributes } from "./config";

describe("telemetry config", () => {
  it("uses the local collector endpoint by default", () => {
    expect(resolveTelemetryConfig({}, "instance-1")).toEqual({
      endpoint: "http://127.0.0.1:54318",
      headers: undefined,
      resourceAttributes: telemetryResourceAttributes({}, "instance-1"),
    });
  });

  it("uses the explicit OTLP endpoint without leaking hosted ingest auth", () => {
    expect(
      resolveTelemetryConfig(
        {
          EVERR_INGEST_KEY: "secret",
          NODE_ENV: "development",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:54318/",
        },
        "instance-1",
      ),
    ).toEqual({
      endpoint: "http://127.0.0.1:54318",
      headers: undefined,
      resourceAttributes: telemetryResourceAttributes(
        {
          NODE_ENV: "development",
        },
        "instance-1",
      ),
    });
  });

  it("uses hosted ingest only when an ingest key is present", () => {
    expect(
      resolveTelemetryConfig(
        {
          DEPLOYMENT_ENVIRONMENT: "production",
          EVERR_INGEST_KEY: "secret",
          SERVICE_VERSION: "release-2026-06-02",
        },
        "instance-1",
      ),
    ).toEqual({
      endpoint: "https://ingest.everr.dev",
      headers: { Authorization: "Bearer secret" },
      resourceAttributes: telemetryResourceAttributes(
        {
          DEPLOYMENT_ENVIRONMENT: "production",
          SERVICE_VERSION: "release-2026-06-02",
        },
        "instance-1",
      ),
    });
  });

  it("derives stable service resource attributes", () => {
    expect(
      telemetryResourceAttributes(
        {
          GITHUB_SHA: "abc123",
          NODE_ENV: "production",
        },
        "instance-1",
      ),
    ).toEqual({
      "deployment.environment.name": "production",
      "service.instance.id": "instance-1",
      "service.name": "everr-dev-app",
      "service.namespace": "everr",
      "service.version": "abc123",
    });
  });

  it("builds OTLP signal URLs from base or signal-specific endpoints", () => {
    expect(signalUrl("http://127.0.0.1:54318", "traces")).toBe("http://127.0.0.1:54318/v1/traces");
    expect(signalUrl("http://127.0.0.1:54318/v1/traces", "logs")).toBe(
      "http://127.0.0.1:54318/v1/logs",
    );
  });
});
