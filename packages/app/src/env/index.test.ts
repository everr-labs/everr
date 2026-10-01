// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("environment validation", () => {
  it("allows missing runtime configuration during builds and preserves provided preset values", async () => {
    vi.stubEnv("SKIP_ENV_VALIDATION", "true");
    vi.stubEnv("DATABASE_HOST", undefined);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "prerender-only-not-a-runtime-secret");
    vi.stubEnv("EMAIL_DSN", "smtp://localhost:1025");

    const { env } = await import("./index");

    expect(env.DATABASE_HOST).toBeUndefined();
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.BETTER_AUTH_SECRET).toBe("prerender-only-not-a-runtime-secret");
    expect(env.EMAIL_DSN).toBe("smtp://localhost:1025");
  });

  it.each([
    undefined,
    "false",
  ])("rejects missing runtime configuration when the build flag is %s", async (flag) => {
    vi.stubEnv("SKIP_ENV_VALIDATION", flag);
    vi.stubEnv("DATABASE_HOST", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("./index")).rejects.toThrow(
      "Invalid environment variables",
    );
  });
});
