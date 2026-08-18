import { describe, expect, it } from "vitest";
import type { AlertingRule, AlertingRuleInput } from "@/data/alerting/types";
import {
  fromAlertingRule,
  isOwnedRule,
  toAlertRuleDocument,
  toRuleInput,
} from "./mapping";
import { AlertRuleYamlSchema } from "./schema";

// Concatenation avoids the no-template-curly-in-string lint.
const TITLE_TEMPLATE = "$" + "{value} 5xx";
const DESC_TEMPLATE = "on $" + "{route}";

const baseInput = {
  kind: "AlertRule",
  metadata: { name: "high-5xx", labels: { team: "platform" } },
  spec: {
    display: { name: "High 5xx", description: "Elevated 5xx." },
    evaluationInterval: "5m",
    severity: "warning",
    notificationMessage: { title: TITLE_TEMPLATE, description: DESC_TEMPLATE },
    query: "SELECT route, count() AS value FROM logs GROUP BY route",
    instanceLabels: ["route"],
    condition: { operator: "gt", threshold: 5 },
  },
};

// Parse fixtures so mapping receives normalized input.
function parseRule(
  spec: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
) {
  return AlertRuleYamlSchema.parse({
    ...baseInput,
    metadata: { ...baseInput.metadata, ...metadata },
    spec: { ...baseInput.spec, ...spec },
  });
}

const rule = parseRule();

/** Convert a create input into the stored rule shape. */
function asRule(
  input: AlertingRuleInput,
): Pick<
  AlertingRule,
  "previewId" | "repoid" | "name" | "notifications" | "spec"
> {
  const { name, repoid, previewId, notifications, ...spec } = input;
  return { name, repoid, previewId, notifications, spec };
}

describe("toRuleInput", () => {
  it("stamps first-class identity, ownership, and the mapped spec fields", () => {
    const input = toRuleInput(rule, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(input.name).toBe("default/high-5xx");
    expect(input.previewId).toBeNull();
    expect(input.repoid).toBe("repo-1");
    expect(input.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/default/high-5xx",
    );
    expect(input.sql).toBe(rule.spec.query);
    expect(input.interval_secs).toBe(300);
    expect(input.for_secs).toBe(0);
    expect(input.resolve_after).toBe(1);
    expect(input.condition).toEqual({ operator: "gt", threshold: 5 });
    expect(input.label_columns).toEqual(["route"]);
    expect(input.severity).toBe("warning");
    expect(input.annotations.summary).toBe(TITLE_TEMPLATE);
    expect(input.annotations.description).toBe(DESC_TEMPLATE);
    expect(input.annotations["everr.label.team"]).toBe("platform");

    // No description in the message -> no description annotation.
    const noDescription = toRuleInput(
      parseRule({ notificationMessage: { title: TITLE_TEMPLATE } }),
      "repo-1",
    );
    expect(noDescription.annotations.description).toBeUndefined();
  });

  // instanceFingerprint sorts label keys before hashing, so authored order
  // carries no identity meaning; storing it as-authored would make a
  // reorder-only edit look like a membership change to the spec diff.
  it("sorts label_columns regardless of authored or inferred order", () => {
    const explicit = toRuleInput(
      parseRule({ instanceLabels: ["zone", "route"] }),
      "repo-1",
    );
    expect(explicit.label_columns).toEqual(["route", "zone"]);

    const inferred = toRuleInput(
      parseRule({ instanceLabels: undefined }),
      "repo-1",
      {
        instanceLabels: ["zone", "route"],
      },
    );
    expect(inferred.label_columns).toEqual(["route", "zone"]);
  });

  it("carries a linked runbook via everr.runbook, and link.runbook when appBaseUrl is set", () => {
    const scoped = toRuleInput(
      parseRule({ runbook: "payments/triage-5xx" }),
      "repo-1",
      { appBaseUrl: "https://app.example.com" },
    );
    expect(scoped.annotations["everr.runbook"]).toBe("payments/triage-5xx");
    expect(scoped.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/payments/triage-5xx",
    );
    expect(fromAlertingRule(asRule(scoped))).toMatchObject({
      runbookProject: "payments",
      runbookSlug: "triage-5xx",
    });

    // A bare authored slug resolves against the alert's own project
    // ("default" here) to interpret user intent, but the stored annotation
    // is always fully qualified: re-applying the exported document must not
    // depend on which project the alert happens to live in.
    const bare = toRuleInput(parseRule({ runbook: "triage-5xx" }), "repo-1");
    expect(bare.annotations["everr.runbook"]).toBe("default/triage-5xx");
    expect(bare.annotations["link.runbook"]).toBeUndefined();
    expect(fromAlertingRule(asRule(bare))).toMatchObject({
      runbookProject: "default",
      runbookSlug: "triage-5xx",
    });
    const noRunbook = toRuleInput(rule, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(noRunbook.annotations["link.runbook"]).toBeUndefined();
  });

  it("round-trips through fromAlertingRule with its qualified identity", () => {
    const input = toRuleInput(
      parseRule({ for: "1d", resolveAfter: 2 }),
      "repo-1",
    );
    expect(fromAlertingRule(asRule(input))).toMatchObject({
      project: "default",
      slug: "high-5xx",
      repoid: "repo-1",
      severity: "warning",
      notificationTitleTemplate: TITLE_TEMPLATE,
      notificationDescriptionTemplate: DESC_TEMPLATE,
      displayName: "High 5xx",
      instanceLabelColumns: ["route"],
      forSeconds: 86400,
      resolveAfter: 2,
      condition: { operator: "gt", threshold: 5 },
    });

    const {
      name: _name,
      repoid: _repoid,
      previewId: _previewId,
      notifications,
      ...spec
    } = input;
    const view = fromAlertingRule({
      previewId: null,
      repoid: "repo-1",
      name: "payments/checkout",
      notifications,
      spec,
    });
    expect(view.project).toBe("payments");
    expect(view.slug).toBe("checkout");
  });

  it("builds a rule in the preview namespace", () => {
    const input = toRuleInput(rule, "repo-1", { previewId: "prev-1" });
    // Preview rules evaluate but cannot notify.
    expect(input.previewId).toBe("prev-1");
    expect(input.repoid).toBe("repo-1");
    const view = fromAlertingRule(asRule(input));
    expect(view.previewId).toBe("prev-1");
  });

  it("sets max_interval_secs when maxInterval is set, else omits it", () => {
    const withMax = toRuleInput(parseRule({ maxInterval: "1h" }), "repo-1");
    expect(withMax.max_interval_secs).toBe(3600);

    const withoutMax = toRuleInput(rule, "repo-1");
    expect(withoutMax.max_interval_secs).toBeUndefined();
  });

  it("maps an explicit notification destination outside the evaluator spec", () => {
    const input = toRuleInput(
      parseRule({ notifications: { channels: ["team-slack", "pager"] } }),
      "repo-1",
    );

    expect(input.notifications?.channels).toEqual(["team-slack", "pager"]);
    expect(fromAlertingRule(asRule(input)).notificationChannels).toEqual([
      "team-slack",
      "pager",
    ]);
  });

  it("merges user annotations, generated keys always winning", () => {
    const input = toRuleInput(
      parseRule({ annotations: { team: "platform-eng", owner: "gio" } }),
      "repo-1",
    );
    expect(input.annotations.team).toBe("platform-eng");
    expect(input.annotations.owner).toBe("gio");
    expect(input.name).toBe("default/high-5xx");
    expect(input.repoid).toBe("repo-1");
  });
});

describe("isOwnedRule", () => {
  it("matches the first-class repoid", () => {
    const owned = asRule(toRuleInput(rule, "repo-1"));
    expect(isOwnedRule(owned)).toBe(true);
    expect(isOwnedRule(owned, "repo-1")).toBe(true);
    expect(isOwnedRule(owned, "repo-2")).toBe(false);
  });
});

describe("toAlertRuleDocument", () => {
  it("round-trips through the schema to an equivalent rule input", () => {
    const parsed = parseRule(
      {
        for: "10m",
        resolveAfter: 3,
        condition: { operator: "gte", threshold: 10 },
        maxInterval: "1h",
        runbook: "ops/high-5xx",
        notifications: { channels: ["team-slack"] },
        annotations: { "team.pager": "platform" },
      },
      { name: "high-5xx" },
    );
    const ruleInput = toRuleInput(parsed, "repo-1");
    const doc = toAlertRuleDocument(asRule(ruleInput));

    const reparsed = AlertRuleYamlSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(reparsed.metadata.name).toBe("high-5xx");
    expect(reparsed.metadata.labels).toEqual({ team: "platform" });
    expect(reparsed.spec.display).toEqual(parsed.spec.display);
    expect(reparsed.spec.runbook).toBe("ops/high-5xx");
    expect(reparsed.spec.notifications).toEqual({ channels: ["team-slack"] });
    expect(reparsed.spec.evaluationInterval).toBe("5m");
    expect(reparsed.spec.for).toBe("10m");
    expect(reparsed.spec.resolveAfter).toBe(3);
    expect(reparsed.spec.condition).toEqual({
      operator: "gte",
      threshold: 10,
    });
    expect(reparsed.spec.maxInterval).toBe("1h");
    expect(reparsed.spec.annotations).toEqual({ "team.pager": "platform" });

    expect(toRuleInput(reparsed, "repo-1")).toEqual(ruleInput);

    // Qualified names preserve non-default projects.
    const scoped = JSON.parse(
      JSON.stringify(
        toAlertRuleDocument(
          asRule(toRuleInput(parseRule({}, { project: "payments" }), "repo-1")),
        ),
      ),
    );
    expect(scoped.metadata.project).toBe("payments");
    expect(scoped.metadata.name).toBe("high-5xx");
  });

  // An exported rule whose whole result is one instance used to omit
  // instanceLabels, so re-applying it inferred an identity from the query
  // instead of keeping the one the rule evaluates on.
  it("exports an empty identity so re-apply cannot re-infer one", () => {
    const ruleInput = toRuleInput(
      parseRule({ instanceLabels: [], query: "SELECT count() AS value" }),
      "repo-1",
    );
    expect(ruleInput.label_columns).toEqual([]);

    const doc = toAlertRuleDocument(asRule(ruleInput));
    expect(doc.spec.instanceLabels).toEqual([]);

    const reparsed = AlertRuleYamlSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(
      toRuleInput(reparsed, "repo-1", { instanceLabels: ["last_event"] })
        .label_columns,
    ).toEqual([]);
  });

  // A runbook in the "default" project, linked from an alert in a
  // different project, used to lose its project on export (formatRunbookRef
  // dropped "default"), so the exported document re-resolved the bare slug
  // against the alert's own project on re-apply.
  it("keeps a default-project runbook qualified when the alert lives elsewhere", () => {
    const parsed = parseRule({ runbook: "default/oom" }, { project: "web" });
    const ruleInput = toRuleInput(parsed, "repo-1");
    expect(ruleInput.annotations["everr.runbook"]).toBe("default/oom");

    const doc = toAlertRuleDocument(asRule(ruleInput));
    expect(doc.metadata.project).toBe("web");
    expect(doc.spec.runbook).toBe("default/oom");

    const reparsed = AlertRuleYamlSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(toRuleInput(reparsed, "repo-1")).toEqual(ruleInput);
  });
});
