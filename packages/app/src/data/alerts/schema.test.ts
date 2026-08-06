import { describe, expect, it } from "vitest";
import { AlertRuleYamlSchema } from "./schema";

const valid = {
  kind: "AlertRule",
  metadata: { name: "high-5xx", labels: { team: "platform" } },
  spec: {
    display: {
      name: "High 5xx",
      description: "Routes with elevated 5xx responses.",
    },
    evaluationInterval: "1m",
    notificationMessage: {
      title: `Route \${route} has elevated 5xxs`,
      description: `Worst route: \${route}`,
    },
    query: "SELECT 1",
    condition: { operator: "gt", threshold: 0 },
  },
};

function parseSpec(spec: Record<string, unknown>) {
  return AlertRuleYamlSchema.safeParse({
    ...valid,
    spec: { ...valid.spec, ...spec },
  });
}

describe("AlertRuleYamlSchema", () => {
  it("rejects malformed metadata and spec values", () => {
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        metadata: { ...valid.metadata, project: "Bad Project" },
      }).success,
    ).toBe(false);
    for (const spec of [
      { instanceLabels: [] },
      { instanceLabels: [""] },
      { runbook: "a/b/c" },
      { runbook: "Bad_Slug" },
      { runbook: "platform/" },
      { condition: { operator: "above", threshold: 1 } },
      { notification: { channels: [] } },
      { notification: { channels: ["team-slack", "team-slack"] } },
    ]) {
      expect(parseSpec(spec).success).toBe(false);
    }
  });

  it("rejects a maxInterval shorter than evaluationInterval", () => {
    const result = parseSpec({
      evaluationInterval: "5m",
      maxInterval: "1m",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toContain("1m");
      expect(message).toContain("5m");
    }
  });

  it("rejects annotation keys reserved for generated sugar", () => {
    for (const key of [
      "everr.name",
      "everr.anything",
      "summary",
      "description",
      "link.alert",
      "link.runbook",
    ]) {
      const result = parseSpec({ annotations: { [key]: "x" } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message ?? "").toContain(key);
      }
    }
  });
});

describe("AlertRuleYamlSchema canonical fields", () => {
  const { query: _query, ...specWithoutQuery } = valid.spec;

  it("rejects retired aliases", () => {
    for (const alias of [
      "notebook",
      "sql",
      "labelColumns",
      "valueColumn",
    ] as const) {
      const result = parseSpec({
        [alias]: alias === "labelColumns" ? ["route"] : "x",
      });
      expect(result.success).toBe(false);
    }
  });

  it("requires query", () => {
    const result = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: specWithoutQuery,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["spec", "query"]);
    }
  });
});
