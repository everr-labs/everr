import { describe, expect, it } from "vitest";
import type { ErrorIssueSummary } from "../data/types";
import { buildErrorHandoffPrompt } from "./error-handoff-button";

function summary(overrides: Partial<ErrorIssueSummary>): ErrorIssueSummary {
  return {
    fingerprint: "fp-1",
    exceptionType: "TypeError",
    exceptionMessage: "boom",
    body: "TypeError: boom",
    latestServiceName: "api",
    services: ["api"],
    occurrenceCount: 1,
    traceCount: 1,
    firstSeen: "2026-07-01 10:00:00",
    lastSeen: "2026-07-09 14:03:11",
    latestTraceId: "trace-1",
    latestSpanId: "span-1",
    latestTimestamp: "2026-07-09 14:03:11",
    ...overrides,
  };
}

describe("buildErrorHandoffPrompt", () => {
  it("includes the fingerprint, a Type: message heading, and the show command", () => {
    const prompt = buildErrorHandoffPrompt(summary({}));

    expect(prompt).toContain("Fingerprint: fp-1");
    expect(prompt).toContain("Error: TypeError: boom");
    expect(prompt).toContain("everr cloud errors show fp-1");
  });

  it("falls back to the body when the exception message is empty", () => {
    const prompt = buildErrorHandoffPrompt(
      summary({
        exceptionType: "",
        exceptionMessage: "",
        body: "raw log line",
      }),
    );

    expect(prompt).toContain("Error: Unknown exception: raw log line");
  });
});
