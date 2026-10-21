// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";

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

  const { env } = await import("#app/env/index.ts");
  const { githubTasks } = await import("#app/integrations/github/registration.ts");
  const { mailer } = await import("#app/lib/mailer.server.ts");
  expect(mailer).toBeNull();
  expect(env.NODE_ENV).toBe("production");
  expect(await githubTasks()).toEqual({});
});
