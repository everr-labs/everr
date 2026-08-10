import { afterEach, describe, expect, it, vi } from "vitest";

// The build writes __PACKAGE_VERSION__ with a define option of the bundler. A
// consumer that does not bundle the code, and this test runner, get the
// development value. These tests examine the two conditions, and they load the
// module again for each of them.

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
