import { describe, expect, it } from "vitest";
import { AlertRuleYamlSchema, parseRunbookRef } from "./schema";

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

describe("AlertRuleYamlSchema", () => {
  it("defaults severity to info and accepts explicit values", () => {
    const parsed = AlertRuleYamlSchema.parse(valid);
    expect(parsed.spec.severity).toBe("info");
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, severity: "critical" },
      }).success,
    ).toBe(true);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, severity: "bogus" },
      }).success,
    ).toBe(false);
  });

  it("rejects empty instanceLabels arrays and entries", () => {
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, instanceLabels: [] },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, instanceLabels: [""] },
      }).success,
    ).toBe(false);
  });

  it("accepts the legacy spec.notebook alias and folds it into runbook", () => {
    const parsed = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: { ...valid.spec, notebook: "platform/db-pool-runbook" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.spec.runbook).toBe("platform/db-pool-runbook");
      expect("notebook" in parsed.data.spec).toBe(false);
    }
  });

  it("rejects setting both spec.runbook and the legacy spec.notebook", () => {
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, runbook: "a", notebook: "b" },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed project and runbook refs", () => {
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        metadata: { ...valid.metadata, project: "Bad Project" },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, runbook: "a/b/c" },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, runbook: "Bad_Slug" },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, runbook: "platform/" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys, missing title, and empty name", () => {
    expect(AlertRuleYamlSchema.safeParse({ ...valid, extra: 1 }).success).toBe(
      false,
    );
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, window: "5m" },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: {
          ...valid.spec,
          notificationMessage: {
            ...valid.spec.notificationMessage,
            title: undefined,
          },
        },
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

describe("AlertRuleYamlSchema spec.sql alias", () => {
  it("accepts spec.sql and normalizes it onto query", () => {
    const { query: _query, ...specWithoutQuery } = valid.spec;
    const parsed = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: { ...specWithoutQuery, sql: "SELECT 2" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.spec.query).toBe("SELECT 2");
      expect("sql" in parsed.data.spec).toBe(false);
    }
  });

  it("rejects setting both spec.query and spec.sql", () => {
    const result = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: { ...valid.spec, sql: "SELECT 2" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toContain("query");
      expect(message).toContain("sql");
    }
  });

  it("rejects when neither spec.query nor spec.sql is set", () => {
    const { query: _query, ...specWithoutQuery } = valid.spec;
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

describe("AlertRuleYamlSchema spec.labelColumns alias", () => {
  it("accepts spec.labelColumns and normalizes it onto instanceLabels", () => {
    const parsed = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: { ...valid.spec, labelColumns: ["route"] },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.spec.instanceLabels).toEqual(["route"]);
      expect("labelColumns" in parsed.data.spec).toBe(false);
    }
  });

  it("rejects setting both spec.instanceLabels and spec.labelColumns", () => {
    const result = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: {
        ...valid.spec,
        instanceLabels: ["route"],
        labelColumns: ["route"],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toContain("instanceLabels");
      expect(message).toContain("labelColumns");
    }
  });
});

describe("AlertRuleYamlSchema spec.maxInterval", () => {
  it("accepts a maxInterval at or above evaluationInterval", () => {
    const parsed = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: { ...valid.spec, evaluationInterval: "1m", maxInterval: "1h" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.spec.maxInterval).toBe("1h");
    }
  });

  it("rejects a maxInterval shorter than evaluationInterval", () => {
    const result = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: { ...valid.spec, evaluationInterval: "5m", maxInterval: "1m" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toContain("1m");
      expect(message).toContain("5m");
    }
  });
});

describe("AlertRuleYamlSchema spec.annotations", () => {
  it("passes through arbitrary annotations", () => {
    const parsed = AlertRuleYamlSchema.safeParse({
      ...valid,
      spec: { ...valid.spec, annotations: { team: "core" } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.spec.annotations).toEqual({ team: "core" });
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
      const result = AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, annotations: { [key]: "x" } },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message ?? "").toContain(key);
      }
    }
  });
});

describe("parseRunbookRef", () => {
  it("defaults the project to the alert's project for a bare slug", () => {
    expect(parseRunbookRef("db-pool-runbook", "platform")).toEqual({
      project: "platform",
      slug: "db-pool-runbook",
    });
  });

  it("uses the explicit project for a project/slug ref", () => {
    expect(parseRunbookRef("infra/db-pool-runbook", "platform")).toEqual({
      project: "infra",
      slug: "db-pool-runbook",
    });
  });
});
