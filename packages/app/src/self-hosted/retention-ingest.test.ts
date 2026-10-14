// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

const secret = "self-hosted-retention-verification-secret";
vi.mock("@/env", () => ({
  env: {
    INGEST_VERIFY_SHARED_SECRET: "self-hosted-retention-verification-secret",
  },
}));
vi.mock("@/lib/auth.server", () => ({
  auth: {
    api: {
      verifyApiKey: vi.fn(async () => ({
        valid: true,
        key: {
          id: "key",
          referenceId: "org",
          permissions: { ingest: ["write"] },
          metadata: null,
        },
      })),
    },
  },
}));
vi.mock("@/cloud/billing-data.server", () => {
  throw new Error("Ingestion loaded cloud billing");
});
afterEach(() => vi.unstubAllEnvs());

it("returns operator retention to the collector through the real deployment policy", async () => {
  vi.resetModules();
  vi.stubEnv("SKIP_ENV_VALIDATION", "false");
  vi.stubEnv("EVERR_RETENTION_DAYS", "90");
  vi.stubEnv("EVERR_RETENTION_LOGS_DAYS", "7");
  vi.stubEnv("EVERR_RETENTION_TRACES_DAYS", "14");
  vi.stubEnv("EVERR_RETENTION_METRICS_DAYS", undefined);
  const { Route } = await import("@/routes/api/internal/verify-key");
  const options = Route.options as unknown as {
    server: {
      handlers: { POST: (args: { request: Request }) => Promise<Response> };
    };
  };
  const response = await options.server.handlers.POST({
    request: new Request("http://localhost/api/internal/verify-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ key: "test-key" }),
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    tenantId: "org",
    keyId: "key",
    tracesDays: 14,
    logsDays: 7,
    metricsDays: 90,
  });
});
