// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["client-id", undefined, false],
  ["client-id", "client-secret", true],
])("advertises Google only with both credentials (%s, %s)", async (id, secret, enabled) => {
  vi.resetModules();
  vi.stubEnv("GOOGLE_CLIENT_ID", id);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", secret);
  const { socialProviders } = await import("#app/lib/auth-providers.server.ts");
  expect(Boolean(socialProviders?.google)).toBe(enabled);
});

it("leaves the ingestion endpoint unset until configured", async () => {
  vi.resetModules();
  vi.stubEnv("EVERR_PUBLIC_INGEST_URL", undefined);
  const { deployment } = await import("@composition/deployment");
  expect(deployment.ingestEndpoint).toBeUndefined();
});

it("publishes the configured public ingestion endpoint", async () => {
  vi.resetModules();
  vi.stubEnv("EVERR_PUBLIC_INGEST_URL", "https://telemetry.example.test/otlp");
  const { deployment } = await import("@composition/deployment");
  expect(deployment.ingestEndpoint).toBe("https://telemetry.example.test/otlp");
});

it.each([
  true,
  false,
])("stamps self-hosted telemetry only in development (%s)", async (dev) => {
  vi.resetModules();
  vi.stubEnv("DEV", dev);
  const { storage } = await import("@composition/storage");
  expect(storage.telemetryTenantId("org_42")).toBe(dev ? "org_42" : undefined);
});

it.each([
  "ftp://telemetry.example.test",
  "https://user:secret@telemetry.example.test",
  "https://telemetry.example.test?key=secret",
])("rejects unsafe public endpoint configuration: %s", async (endpoint) => {
  vi.resetModules();
  vi.stubEnv("SKIP_ENV_VALIDATION", "false");
  vi.stubEnv("EVERR_PUBLIC_INGEST_URL", endpoint);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(import("@composition/deployment")).rejects.toThrow(
      "Invalid environment variables",
    );
  } finally {
    error.mockRestore();
  }
});
