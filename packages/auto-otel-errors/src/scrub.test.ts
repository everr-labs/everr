import { describe, expect, it } from "vitest";
import { DEFAULT_SCRUB_PATTERNS, scrubAttributes, scrubString } from "./scrub.js";

describe("scrubString", () => {
  it("filters bearer tokens", () => {
    expect(scrubString("auth: Bearer abc.def-123", DEFAULT_SCRUB_PATTERNS)).toBe(
      "auth: [Filtered]",
    );
  });

  it("filters sensitive query params but keeps the param name", () => {
    expect(
      scrubString("GET /cb?token=s3cret&page=2", DEFAULT_SCRUB_PATTERNS),
    ).toBe("GET /cb?token=[Filtered]&page=2");
  });

  it("filters card-shaped numbers and emails", () => {
    expect(
      scrubString("card 4242 4242 4242 4242 for a@b.com", DEFAULT_SCRUB_PATTERNS),
    ).toBe("card [Filtered] for [Filtered]");
  });

  it("applies custom patterns", () => {
    expect(scrubString("ssn 123-45-6789", [/\d{3}-\d{2}-\d{4}/g])).toBe(
      "ssn [Filtered]",
    );
  });
});

describe("scrubAttributes", () => {
  it("scrubs string values and leaves other types alone", () => {
    const result = scrubAttributes(
      { url: "/cb?password=hunter2", count: 3, ok: true },
      DEFAULT_SCRUB_PATTERNS,
    );
    expect(result).toEqual({
      url: "/cb?password=[Filtered]",
      count: 3,
      ok: true,
    });
  });
});
