import { describe, expect, it } from "vitest";
import { buildOtlpSignalUrl, normalizeOtlpOrigin } from "./otlp";
import { buildOtlpSignalUrl as buildSharedOtlpSignalUrl } from "./shared.ts";

describe("OTLP endpoint helpers", () => {
  it("normalizes the collector origin without a trailing slash", () => {
    expect(normalizeOtlpOrigin("http://127.0.0.1:54318/")).toBe(
      "http://127.0.0.1:54318",
    );
  });

  it("builds signal-specific OTLP HTTP URLs", () => {
    expect(buildOtlpSignalUrl("http://127.0.0.1:54318/", "traces")).toBe(
      "http://127.0.0.1:54318/v1/traces",
    );
  });

  it("shares URL construction with Node instrumentation", () => {
    expect(buildSharedOtlpSignalUrl("http://127.0.0.1:54318/", "logs")).toBe(
      buildOtlpSignalUrl("http://127.0.0.1:54318/", "logs"),
    );
  });
});
