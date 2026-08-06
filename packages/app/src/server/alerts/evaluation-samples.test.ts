import { describe, expect, it } from "vitest";
import {
  ALERT_EVALUATION_SAMPLE_LIMIT,
  captureAlertEvaluationSamples,
} from "./evaluation-samples";

describe("captureAlertEvaluationSamples", () => {
  it("captures values on both sides of the condition using the rule identity", () => {
    const result = captureAlertEvaluationSamples(
      [
        { service: "api", value: "8" },
        { service: "worker", value: 2 },
      ],
      ["service"],
    );

    expect(result).toEqual({
      samples: [
        {
          fingerprint: expect.any(String),
          labels: { service: "api" },
          value: 8,
        },
        {
          fingerprint: expect.any(String),
          labels: { service: "worker" },
          value: 2,
        },
      ],
      truncated: false,
    });
  });

  it("deduplicates label sets and bounds high-cardinality results", () => {
    const rows = Array.from(
      { length: ALERT_EVALUATION_SAMPLE_LIMIT + 2 },
      (_, i) => ({ service: `service-${i}`, value: i }),
    );
    rows.push({ service: "service-0", value: 999 });

    const result = captureAlertEvaluationSamples(rows, ["service"]);

    expect(result.samples).toHaveLength(ALERT_EVALUATION_SAMPLE_LIMIT);
    expect(result.samples[0]).toMatchObject({
      labels: { service: "service-0" },
      value: 0,
    });
    expect(result.truncated).toBe(true);
  });
});
