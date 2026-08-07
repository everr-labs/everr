import { describe, expect, it } from "vitest";
import {
  alertingConditionMatches,
  alertingConditionOperatorLabel,
  alertingConditionValue,
} from "./condition";

describe("alerting conditions", () => {
  it.each([
    ["gt", 11, 10, true],
    ["gt", 10, 10, false],
    ["gte", 10, 10, true],
    ["lt", 9, 10, true],
    ["lt", 10, 10, false],
    ["lte", 10, 10, true],
    ["eq", 10, 10, true],
    ["neq", 9, 10, true],
  ] as const)("%s compares %s against %s", (operator, value, threshold, expected) => {
    expect(alertingConditionMatches({ value }, { operator, threshold })).toBe(
      expected,
    );
  });

  it("accepts ClickHouse numeric strings but treats missing and invalid values as non-matches", () => {
    const condition = {
      operator: "gt" as const,
      threshold: 10,
    };
    expect(alertingConditionValue({ value: "10.5" })).toBe(10.5);
    expect(alertingConditionMatches({ value: "10.5" }, condition)).toBe(true);
    for (const value of [null, undefined, "", "not-a-number", true]) {
      expect(alertingConditionValue({ value })).toBeNull();
      expect(alertingConditionMatches({ value }, condition)).toBe(false);
    }
  });

  it("formats operators for the rule detail", () => {
    expect(alertingConditionOperatorLabel("gte")).toBe(">=");
    expect(alertingConditionOperatorLabel("neq")).toBe("!=");
  });
});
