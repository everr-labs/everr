// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it("validates production configuration and registers no integration jobs with optional integrations disabled", async () => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (/^(GITHUB_APP_|GOOGLE_CLIENT_|INGRESS_)/.test(key)) {
      vi.stubEnv(key, undefined);
    }
  }
  vi.stubEnv("SKIP_ENV_VALIDATION", "false");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TSS_PRERENDERING", undefined);
  vi.stubEnv("EVERR_GITHUB_ENABLED", undefined);
  vi.stubEnv("EMAIL_DSN", undefined);
  vi.stubEnv("EMAIL_FROM", undefined);

  const { env } = await import("@/env/index");
  const { githubTasks } = await import("@/integrations/github/registration");
  const { mailer } = await import("@/lib/mailer.server");
  expect(mailer).toBeNull();
  expect(env.NODE_ENV).toBe("production");
  expect(await githubTasks()).toEqual({});
});
