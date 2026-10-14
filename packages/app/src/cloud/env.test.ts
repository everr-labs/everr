// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("cloud billing configuration", () => {
  it("requires Polar credentials in a cloud build", async () => {
    vi.stubEnv("SKIP_ENV_VALIDATION", "false");
    vi.stubEnv("POLAR_ACCESS_TOKEN", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(import("@/cloud/app/env")).rejects.toThrow(
      "Invalid environment variables",
    );
  });
});
