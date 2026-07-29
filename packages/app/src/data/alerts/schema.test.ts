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

describe("AlertRuleYamlSchema aliases", () => {
  const { query: _query, ...specWithoutQuery } = valid.spec;

  it("folds the legacy and clickety-clack-native aliases onto the canonical fields", () => {
    const parsed = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: {
        ...specWithoutQuery,
        notebook: "platform/db-pool-runbook",
        sql: "SELECT 2",
        labelColumns: ["route"],
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.spec.runbook).toBe("platform/db-pool-runbook");
      expect(parsed.data.spec.query).toBe("SELECT 2");
      expect(parsed.data.spec.instanceLabels).toEqual(["route"]);
      expect("notebook" in parsed.data.spec).toBe(false);
      expect("sql" in parsed.data.spec).toBe(false);
      expect("labelColumns" in parsed.data.spec).toBe(false);
    }
  });

  it("rejects setting an alias alongside its canonical field", () => {
    for (const [spec, canonical, alias] of [
      [{ runbook: "triage", notebook: "db-pool" }, "runbook", "notebook"],
      [{ sql: "SELECT 2" }, "query", "sql"],
      [
        { instanceLabels: ["route"], labelColumns: ["route"] },
        "instanceLabels",
        "labelColumns",
      ],
    ] as const) {
      const result = parseSpec(spec);
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = result.error.issues[0]?.message ?? "";
        expect(message).toContain(canonical);
        expect(message).toContain(alias);
      }
    }
  });

  it("requires query or its sql alias", () => {
    const result = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: specWithoutQuery,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message ?? "").toContain("query");
    }
  });
});
