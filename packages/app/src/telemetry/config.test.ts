import { describe, expect, it, vi } from "vite-plus/test";
import {
  resolveBrowserTelemetryConfig,
  resolveTelemetryConfig,
  signalUrl,
  telemetryResourceAttributes,
} from "./config";

vi.mock("@composition/client", () => ({
  productClient: { telemetryEndpoint: undefined },
}));

describe("telemetry config", () => {
  it("uses the local collector in development when no endpoint is configured", () => {
    const env = { NODE_ENV: "development" };
    expect(resolveTelemetryConfig(env, "instance-1")).toEqual({
      endpoint: "http://127.0.0.1:54318",
      headers: undefined,
      resourceAttributes: telemetryResourceAttributes(env, "instance-1"),
    });
  });

  it("does not configure telemetry in production without an endpoint", () => {
    expect(resolveTelemetryConfig({ NODE_ENV: "production" }, "instance-1")).toBeNull();
  });

  it("uses the explicit OTLP endpoint without leaking ingest credentials", () => {
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

  it("requires an endpoint even when an ingest key is present", () => {
    const env = {
      DEPLOYMENT_ENVIRONMENT: "production",
      EVERR_INGEST_KEY: "secret",
      SERVICE_VERSION: "release-2026-06-02",
    };
    expect(resolveTelemetryConfig(env, "instance-1")).toBeNull();
  });

  it("keeps the local development default when only a key is configured", () => {
    const env = { NODE_ENV: "development", EVERR_INGEST_KEY: "secret" };
    expect(resolveTelemetryConfig(env, "instance-1")).toEqual({
      endpoint: "http://127.0.0.1:54318",
      headers: undefined,
      resourceAttributes: telemetryResourceAttributes(env, "instance-1"),
    });
  });

  it("uses an authenticated custom Everr ingest endpoint", () => {
    expect(
      resolveTelemetryConfig(
        {
          EVERR_INGEST_ENDPOINT: "http://127.0.0.1:4318/",
          EVERR_INGEST_KEY: "secret",
          NODE_ENV: "development",
        },
        "instance-1",
      ),
    ).toEqual({
      endpoint: "http://127.0.0.1:4318",
      headers: { Authorization: "Bearer secret" },
      resourceAttributes: telemetryResourceAttributes(
        {
          NODE_ENV: "development",
        },
        "instance-1",
      ),
    });
  });

  it("uses only the configured browser endpoint when a key is present", () => {
    const config = resolveBrowserTelemetryConfig({ publicKey: "public-key" });
    expect(config).toEqual({ endpoint: undefined, ingestKey: undefined });
  });

  it("preserves an explicit browser endpoint and public key", () => {
    expect(
      resolveBrowserTelemetryConfig({
        endpoint: "https://collector.example/",
        publicKey: "public-key",
      }),
    ).toEqual({
      endpoint: "https://collector.example/",
      ingestKey: "public-key",
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
