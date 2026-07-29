import { describe, expect, it } from "vitest";
import type { CcRule, CcRuleInput } from "@/data/cc/types";
import {
  fromCcRule,
  isOwnedRule,
  OWN_REPO,
  previewIdOf,
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
    query: "SELECT route, count() AS count FROM logs GROUP BY route",
    instanceLabels: ["route"],
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

/** Convert an input into CC's returned rule shape. */
function asRule(
  input: CcRuleInput,
): Pick<CcRule, "namespace" | "name" | "spec"> {
  const { name, namespace, ...spec } = input;
  return { name, namespace, spec };
}

describe("toRuleInput", () => {
  it("stamps first-class identity, ownership, and the mapped spec fields", () => {
    const input = toRuleInput(rule, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(input.name).toBe("default/high-5xx");
    expect(input.namespace).toBe("");
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(input.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/default/high-5xx",
    );
    expect(input.sql).toBe(rule.spec.query);
    expect(input.interval_secs).toBe(300);
    expect(input.for_secs).toBe(0);
    expect(input.resolve_after).toBe(1);
    expect(input.value_column).toBeNull();
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
    expect(fromCcRule(asRule(scoped))).toMatchObject({
      runbookProject: "payments",
      runbookSlug: "triage-5xx",
    });

    // Bare slug resolves against the alert's own project ("default" here), and
    // without a base URL (or without a runbook) there is no link annotation.
    const bare = toRuleInput(parseRule({ runbook: "triage-5xx" }), "repo-1");
    expect(bare.annotations["everr.runbook"]).toBe("triage-5xx");
    expect(bare.annotations["link.runbook"]).toBeUndefined();
    expect(fromCcRule(asRule(bare))).toMatchObject({
      runbookProject: "default",
      runbookSlug: "triage-5xx",
    });
    const noRunbook = toRuleInput(rule, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(noRunbook.annotations["link.runbook"]).toBeUndefined();
  });

  it("round-trips through fromCcRule, reading project/slug off the CC name", () => {
    const input = toRuleInput(
      parseRule({ for: "1d", resolveAfter: 2, valueColumn: "count" }),
      "repo-1",
    );
    expect(fromCcRule(asRule(input))).toMatchObject({
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
      valueColumn: "count",
    });

    const { name: _name, namespace: _namespace, ...spec } = input;
    const view = fromCcRule({ namespace: "", name: "payments/checkout", spec });
    expect(view.project).toBe("payments");
    expect(view.slug).toBe("checkout");
  });

  it("builds a suppressed rule in the preview namespace", () => {
    const input = toRuleInput(rule, "repo-1", { previewId: "prev-1" });
    // Preview rules evaluate but cannot notify.
    expect(input.namespace).toBe("prev-1");
    expect(input.suppressed).toBe(true);
    expect(previewIdOf({ namespace: input.namespace })).toBe("prev-1");
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    const view = fromCcRule(asRule(input));
    expect(view.previewId).toBe("prev-1");
    expect(view.suppressed).toBe(true);
  });

  it("sets max_interval_secs when maxInterval is set, else omits it", () => {
    const withMax = toRuleInput(parseRule({ maxInterval: "1h" }), "repo-1");
    expect(withMax.max_interval_secs).toBe(3600);

    const withoutMax = toRuleInput(rule, "repo-1");
    expect(withoutMax.max_interval_secs).toBeUndefined();
  });

  it("merges user annotations, generated keys always winning", () => {
    const input = toRuleInput(
      parseRule({ annotations: { team: "platform-eng", owner: "gio" } }),
      "repo-1",
    );
    expect(input.annotations.team).toBe("platform-eng");
    expect(input.annotations.owner).toBe("gio");
    expect(input.name).toBe("default/high-5xx");
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
  });
});

describe("isOwnedRule", () => {
  it("requires everr.repoid and (optionally) a matching repo", () => {
    const owned = asRule(toRuleInput(rule, "repo-1"));
    expect(isOwnedRule(owned)).toBe(true);
    expect(isOwnedRule(owned, "repo-1")).toBe(true);
    expect(isOwnedRule(owned, "repo-2")).toBe(false);
    // A rule without everr.repoid is unowned.
    const unowned = { ...owned, spec: { ...owned.spec, annotations: {} } };
    expect(isOwnedRule(unowned)).toBe(false);
    expect(isOwnedRule(unowned, "repo-1")).toBe(false);
  });
});

describe("toAlertRuleDocument", () => {
  it("round-trips through the schema and back to an equivalent CC rule input", () => {
    const parsed = parseRule(
      {
        for: "10m",
        resolveAfter: 3,
        valueColumn: "count",
        maxInterval: "1h",
        runbook: "ops/high-5xx",
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
    expect(reparsed.spec.evaluationInterval).toBe("5m");
    expect(reparsed.spec.for).toBe("10m");
    expect(reparsed.spec.resolveAfter).toBe(3);
    expect(reparsed.spec.maxInterval).toBe("1h");
    expect(reparsed.spec.annotations).toEqual({ "team.pager": "platform" });

    expect(toRuleInput(reparsed, "repo-1")).toEqual(ruleInput);

    // A non-default project comes back off the CC name.
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
});
