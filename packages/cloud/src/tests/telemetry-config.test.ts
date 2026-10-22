import { resolveBrowserTelemetryConfig, resolveTelemetryConfig } from "@everr/app/telemetry/config";
import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => vi.unstubAllEnvs());

it.each([true, false])("advertises the shared collector only in development (%s)", async (dev) => {
  vi.resetModules();
  vi.stubEnv("DEV", dev);
  const { deployment } = await import("@composition/deployment");
  expect(deployment.ingestEndpoint).toBe(
    dev ? "http://localhost:4318" : "https://ingest.everr.dev/",
  );
});

it("uses the hosted receiver when an ingest key is configured", () => {
  expect(
    resolveTelemetryConfig({ NODE_ENV: "production", EVERR_INGEST_KEY: "secret" }, "test"),
  ).toMatchObject({
    endpoint: "https://ingest.everr.dev",
    headers: { Authorization: "Bearer secret" },
  });
  expect(resolveBrowserTelemetryConfig({ publicKey: "public" })).toEqual({
    endpoint: "https://ingest.everr.dev",
    ingestKey: "public",
  });
});
