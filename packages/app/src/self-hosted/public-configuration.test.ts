// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it.each([
  [undefined, undefined, false],
  ["client-id", undefined, false],
  [undefined, "client-secret", false],
  ["client-id", "client-secret", true],
])("advertises Google only with both credentials (%s, %s)", async (id, secret, enabled) => {
  vi.resetModules();
  vi.stubEnv("GOOGLE_CLIENT_ID", id);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", secret);
  const { getAuthProviders } = await import("@/data/auth-providers");
  expect(await getAuthProviders()).toEqual({ googleSignInEnabled: enabled });
});

it("does not substitute a Cloud endpoint when the operator has configured none", async () => {
  vi.resetModules();
  vi.stubEnv("EVERR_PUBLIC_INGEST_URL", undefined);
  const { getIngestEndpoint } = await import("@app/ingest");
  expect(getIngestEndpoint()).toBeUndefined();
});

it("publishes the configured public ingestion endpoint", async () => {
  vi.resetModules();
  vi.stubEnv("EVERR_PUBLIC_INGEST_URL", "https://telemetry.example.test/otlp");
  const { getIngestEndpoint } = await import("@app/ingest");
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
    await expect(import("@app/ingest")).rejects.toThrow(
      "Invalid environment variables",
    );
  } finally {
    error.mockRestore();
  }
});
