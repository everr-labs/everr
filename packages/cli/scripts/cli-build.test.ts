import { afterEach, describe, expect, it, vi } from "vitest";
import { embeddedBuildEnv, resolveCliBuild } from "./cli-build";

afterEach(() => vi.unstubAllEnvs());

describe("product telemetry in CLI releases", () => {
  it("rejects official releases without a dedicated product key", () => {
    for (const key of [undefined, "", "  "]) {
      expect(() => resolveCliBuild("release", {
        EVERR_REQUIRE_INTERNAL_TELEMETRY: "1",
        EVERR_INTERNAL_TELEMETRY_INGEST_KEY: key,
        EVERR_INGEST_KEY: "build-key-is-not-a-product-key",
      })).toThrow("EVERR_INTERNAL_TELEMETRY_INGEST_KEY");
    }
    expect(() => resolveCliBuild("release", {
      EVERR_REQUIRE_INTERNAL_TELEMETRY: "1",
      EVERR_INTERNAL_TELEMETRY_INGEST_KEY: "product-key",
    })).not.toThrow();
  });

  it("allows personal release builds and debug builds without a key", () => {
    expect(() => resolveCliBuild("release", {})).not.toThrow();
    expect(() => resolveCliBuild("debug", { EVERR_REQUIRE_INTERNAL_TELEMETRY: "1" })).not.toThrow();
  });

  it("passes only the dedicated key to the Rust build", () => {
    vi.stubEnv("EVERR_INGEST_KEY", "build-key");
    vi.stubEnv("EVERR_INTERNAL_TELEMETRY_INGEST_KEY", "product-key");
    const env = embeddedBuildEnv();
    expect(env.EVERR_INGEST_KEY).toBeUndefined();
    expect(env.EVERR_INTERNAL_TELEMETRY_INGEST_KEY).toBe("product-key");
    expect(process.env.EVERR_INGEST_KEY).toBe("build-key");
  });
});
