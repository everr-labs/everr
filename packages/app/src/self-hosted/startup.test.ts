// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it("validates production configuration and registers no integration jobs without cloud services", async () => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (/^(POLAR_|GITHUB_APP_|GOOGLE_CLIENT_|INGRESS_)/.test(key)) {
      vi.stubEnv(key, undefined);
    }
  }
  vi.stubEnv("SKIP_ENV_VALIDATION", "false");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TSS_PRERENDERING", undefined);
  vi.stubEnv("EVERR_GITHUB_ENABLED", undefined);
  vi.stubEnv("EVERR_SETUP_TOKEN", undefined);
  vi.stubEnv("EMAIL_DSN", "smtp://localhost:1025");

  const { env } = await import("@/env");
  const { integrationTasks } = await import("@app/integrations");
  expect(env.NODE_ENV).toBe("production");
  expect(Object.keys(env).some((key) => key.startsWith("POLAR_"))).toBe(false);
  expect(await integrationTasks()).toEqual({});
});
