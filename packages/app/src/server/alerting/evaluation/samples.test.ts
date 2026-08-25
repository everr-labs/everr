import { describe, expect, it } from "vitest";
import { instanceFingerprint } from "./instances";
import {
  ALERT_EVALUATION_SAMPLE_LIMIT,
  captureAlertEvaluationSamples,
} from "./samples";

describe("captureAlertEvaluationSamples", () => {
  it("captures values on both sides of the condition using the rule identity", () => {
    const result = captureAlertEvaluationSamples(
      [
        { service: "api", value: "8" },
        { service: "worker", value: 2 },
      ],
      ["service"],
      new Set(),
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

    const result = captureAlertEvaluationSamples(rows, ["service"], new Set());

    expect(result.samples).toHaveLength(ALERT_EVALUATION_SAMPLE_LIMIT);
    expect(result.samples[0]).toMatchObject({
      labels: { service: "service-0" },
      value: 0,
    });
    expect(result.truncated).toBe(true);
  });

  // The regression: samples sliced raw query order, so a breach sitting past
  // the cap in an otherwise-healthy result set never made it into the stored
  // samples at all, and the series that reads them (evaluation-series.ts)
  // had nothing to find.
  it("puts matching label sets first so a late breach survives the sample cap", () => {
    const rows = Array.from(
      { length: ALERT_EVALUATION_SAMPLE_LIMIT },
      (_, i) => ({ service: `healthy-${i}`, value: 1 }),
    );
    rows.push({ service: "breaching", value: 999 });
    const matchingFingerprint = instanceFingerprint({ service: "breaching" });

    const result = captureAlertEvaluationSamples(
      rows,
      ["service"],
      new Set([matchingFingerprint]),
    );

    expect(result.samples).toHaveLength(ALERT_EVALUATION_SAMPLE_LIMIT);
    expect(result.samples[0]).toMatchObject({
      labels: { service: "breaching" },
      value: 999,
    });
    expect(result.truncated).toBe(true);
  });
});
