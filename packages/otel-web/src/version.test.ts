import { afterEach, describe, expect, it, vi } from "vitest";

// The build stamps __PACKAGE_VERSION__ via a bundler define; unbundled
// consumers (and this test runner) get the dev fallback. Both sides of that
// contract, driven through fresh module loads.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("SDK version", () => {
  it("falls back to the dev version without a build define", async () => {
    const { SDK_VERSION, SDK_NAME } = await import("./version.js");
    expect(SDK_VERSION).toBe("0.0.0-dev");
    expect(SDK_NAME).toBe("@everr/otel-web");
  });

  it("carries the build-time version when the define is present", async () => {
    vi.stubGlobal("__PACKAGE_VERSION__", "9.9.9");
    vi.resetModules();
    const { SDK_VERSION } = await import("./version.js");
    expect(SDK_VERSION).toBe("9.9.9");
  });
});
