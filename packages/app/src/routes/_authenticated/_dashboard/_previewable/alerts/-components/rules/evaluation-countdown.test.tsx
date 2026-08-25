import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  EvaluationCountdown,
  formatEvaluationCountdown,
} from "./evaluation-countdown";

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

describe("EvaluationCountdown", () => {
  const renderAt = (nextEvaluationAt: string | null, paused = false) => {
    render(
      <EvaluationCountdown
        nextEvaluationAt={nextEvaluationAt}
        paused={paused}
      />,
    );
  };
  const secondsFromNow = (seconds: number) =>
    new Date(Date.now() + seconds * 1_000).toISOString();

  it("counts down to the next evaluation", () => {
    renderAt(secondsFromNow(45));
    expect(screen.getByText(/Next in 4[45]s/)).toBeInTheDocument();
  });

  it("treats a few seconds late as scheduling jitter", () => {
    renderAt(secondsFromNow(-5));
    expect(screen.getByText("Evaluation due")).toBeInTheDocument();
  });

  // A rule whose evaluations stopped must not read the same as one that is
  // about to run.
  it("says how far behind a stalled rule is", () => {
    renderAt(secondsFromNow(-600));
    expect(screen.getByText(/Overdue by 10m/)).toBeInTheDocument();
  });

  it("says nothing is scheduled while paused", () => {
    renderAt(secondsFromNow(-600), true);
    expect(screen.getByText("Next evaluation paused")).toBeInTheDocument();
  });
});
