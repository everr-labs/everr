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
  const { socialProviders } = await import("@/lib/auth-providers.server");
  expect(Boolean(socialProviders?.google)).toBe(enabled);
});

it("leaves the ingestion endpoint unset until configured", async () => {
  vi.resetModules();
  vi.stubEnv("EVERR_PUBLIC_INGEST_URL", undefined);
  const {
    server: { getIngestEndpoint },
  } = await import("@composition/server");
  expect(getIngestEndpoint()).toBeUndefined();
});

it("publishes the configured public ingestion endpoint", async () => {
  vi.resetModules();
  vi.stubEnv("EVERR_PUBLIC_INGEST_URL", "https://telemetry.example.test/otlp");
  const {
    server: { getIngestEndpoint },
  } = await import("@composition/server");
  expect(getIngestEndpoint()).toBe("https://telemetry.example.test/otlp");
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
    await expect(import("@composition/server")).rejects.toThrow(
      "Invalid environment variables",
    );
  } finally {
    error.mockRestore();
  }
});
