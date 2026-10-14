// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());
it("validates runtime configuration without Polar or GitHub configuration", async () => {
  vi.resetModules();
  vi.stubEnv("SKIP_ENV_VALIDATION", "false");
  for (const name of [
    "POLAR_ACCESS_TOKEN",
    "POLAR_WEBHOOK_SECRET",
    "POLAR_PRO_PRODUCT_ID",
    "POLAR_SERVER",
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALL_URL",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_STATE_SECRET",
    "GITHUB_APP_WEBHOOK_SECRET",
    "INGRESS_COLLECTOR_URL",
    "INGRESS_SOURCE",
  ]) {
    vi.stubEnv(name, undefined);
  }
  for (const name of [
    "BETTER_AUTH_SECRET",
    "INGEST_VERIFY_SHARED_SECRET",
    "CLICKHOUSE_SQL_API_MASTER_KEY",
  ]) {
    vi.stubEnv(name, "self-hosted-test-secret-with-at-least-32-characters");
  }
  const { env } = await import("@/env");
  expect(env.BETTER_AUTH_URL).toBe("http://localhost:5173");
  expect(Object.keys(env).some((key) => key.startsWith("POLAR_"))).toBe(false);
});
