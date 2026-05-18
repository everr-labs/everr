import { describe, expect, it } from "vitest";
import { getNodeTelemetryConfig } from "./node-config";

describe("Node telemetry config", () => {
  it("uses the local collector by default outside production", () => {
    expect(getNodeTelemetryConfig({ NODE_ENV: "development" })).toMatchObject({
      endpoint: "http://127.0.0.1:54318",
      serviceName: "everr-web-node",
      deploymentEnvironment: "development",
    });
  });

  it("does not default to the local collector in production", () => {
    expect(getNodeTelemetryConfig({ NODE_ENV: "production" })).toBeNull();
  });

  it("uses Everr cloud ingest when an ingest key is configured", () => {
    expect(
      getNodeTelemetryConfig({
        NODE_ENV: "production",
        EVERR_INGEST_KEY: "ek_test",
      }),
    ).toMatchObject({
      endpoint: "https://ingest.everr.dev",
      headers: {
        Authorization: "Bearer ek_test",
      },
      deploymentEnvironment: "production",
    });
  });

  it("lets an explicit OTLP endpoint override the default endpoint", () => {
    expect(
      getNodeTelemetryConfig({
        NODE_ENV: "production",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com/",
      }),
    ).toMatchObject({
      endpoint: "https://collector.example.com/",
      deploymentEnvironment: "production",
    });
  });

  it("keeps standard OTLP headers and lets EVERR_INGEST_KEY set Authorization", () => {
    expect(
      getNodeTelemetryConfig({
        NODE_ENV: "production",
        EVERR_INGEST_KEY: "ek_test",
        OTEL_EXPORTER_OTLP_HEADERS: "x-env=prod,x-owner=team%20web",
      })?.headers,
    ).toEqual({
      Authorization: "Bearer ek_test",
      "x-env": "prod",
      "x-owner": "team web",
    });
  });
});
