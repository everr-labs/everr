import { describe, expect, it } from "vitest";
import { AlertRuleYamlSchema, EverrConfigYamlSchema } from "./schema";

const valid = {
  kind: "AlertRule",
  metadata: { name: "high-5xx", labels: { team: "platform" } },
  spec: {
    evaluationInterval: "1m",
    window: "5m",
    summary: `\${row_count} routes have elevated 5xxs`,
    query: "SELECT 1",
  },
};

describe("AlertRuleYamlSchema", () => {
  it("accepts a valid rule", () => {
    expect(AlertRuleYamlSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown keys, missing summary, and empty name", () => {
    expect(AlertRuleYamlSchema.safeParse({ ...valid, extra: 1 }).success).toBe(
      false,
    );
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, summary: undefined },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        metadata: { name: "" },
      }).success,
    ).toBe(false);
  });
});

describe("EverrConfigYamlSchema", () => {
  it("accepts only { repoid } and rejects extras or empty values", () => {
    expect(EverrConfigYamlSchema.safeParse({ repoid: "repo-1" }).success).toBe(
      true,
    );
    expect(EverrConfigYamlSchema.safeParse({ repoid: "" }).success).toBe(false);
    expect(
      EverrConfigYamlSchema.safeParse({ repoid: "repo-1", projects: [] })
        .success,
    ).toBe(false);
  });
});
