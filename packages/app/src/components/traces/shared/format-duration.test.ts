import { describe, expect, it } from "vitest";
import { formatDurationNs } from "./format-duration";

describe("formatDurationNs", () => {
  it("renders sub-microsecond as ns", () => {
    expect(formatDurationNs(0n)).toBe("0ns");
    expect(formatDurationNs(999n)).toBe("999ns");
  });

  it("rolls over to μs at 1000ns", () => {
    expect(formatDurationNs(1_000n)).toBe("1.0μs");
  });

  it("rolls over to ms at 1_000_000ns", () => {
    expect(formatDurationNs(1_000_000n)).toBe("1.00ms");
  });

  it("rolls over to s at 1_000_000_000ns", () => {
    expect(formatDurationNs(1_000_000_000n)).toBe("1.00s");
  });

  it("rolls over to m / s at 60s", () => {
    expect(formatDurationNs(60_000_000_000n)).toBe("1m 0s");
  });

  it("accepts string and number inputs", () => {
    expect(formatDurationNs("1000000")).toBe("1.00ms");
    expect(formatDurationNs(1_500_000)).toBe("1.50ms");
  });
});
