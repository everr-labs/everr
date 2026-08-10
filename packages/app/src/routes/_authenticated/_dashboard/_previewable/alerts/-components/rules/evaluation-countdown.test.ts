import { describe, expect, it } from "vitest";
import { formatEvaluationCountdown } from "./evaluation-countdown";

describe("formatEvaluationCountdown", () => {
  it("keeps seconds visible across short and long evaluation intervals", () => {
    expect(formatEvaluationCountdown(42)).toBe("42s");
    expect(formatEvaluationCountdown(72)).toBe("1m 12s");
    expect(formatEvaluationCountdown(3_723)).toBe("1h 2m 3s");
  });

  it("rounds partial seconds up and clamps overdue values", () => {
    expect(formatEvaluationCountdown(1.1)).toBe("2s");
    expect(formatEvaluationCountdown(-5)).toBe("0s");
  });
});
