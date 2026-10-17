import { expect, it } from "vitest";
import { resolveBrowserTelemetryConfig, resolveTelemetryConfig } from "@everr/app/telemetry/config";

it("uses the hosted receiver when an ingest key is configured", () => {
  expect(resolveTelemetryConfig({ NODE_ENV: "production", EVERR_INGEST_KEY: "secret" }, "test")).toMatchObject({
    endpoint: "https://ingest.everr.dev",
    headers: { Authorization: "Bearer secret" },
  });
  expect(resolveBrowserTelemetryConfig({ publicKey: "public" })).toEqual({
    endpoint: "https://ingest.everr.dev",
    ingestKey: "public",
  });
});
