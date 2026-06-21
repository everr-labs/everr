import { describe, expect, it } from "vitest";
import {
  AlertRuleYamlSchema,
  EverrConfigYamlSchema,
  parseNotebookRef,
} from "./schema";

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
  it("accepts a valid rule", () => {
    expect(AlertRuleYamlSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional spec.instanceLabels", () => {
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, instanceLabels: ["route"] },
      }).success,
    ).toBe(true);
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

  it("accepts optional metadata.project and spec.notebook", () => {
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        metadata: { ...valid.metadata, project: "platform" },
        spec: { ...valid.spec, notebook: "db-pool-runbook" },
      }).success,
    ).toBe(true);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, notebook: "platform/db-pool-runbook" },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed project and notebook refs", () => {
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        metadata: { ...valid.metadata, project: "Bad Project" },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, notebook: "a/b/c" },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, notebook: "Bad_Slug" },
      }).success,
    ).toBe(false);
    expect(
      AlertRuleYamlSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, notebook: "platform/" },
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

describe("parseNotebookRef", () => {
  it("defaults the project to the alert's project for a bare slug", () => {
    expect(parseNotebookRef("db-pool-runbook", "platform")).toEqual({
      project: "platform",
      slug: "db-pool-runbook",
    });
  });

  it("uses the explicit project for a project/slug ref", () => {
    expect(parseNotebookRef("infra/db-pool-runbook", "platform")).toEqual({
      project: "infra",
      slug: "db-pool-runbook",
    });
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
