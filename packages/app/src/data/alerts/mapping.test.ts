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

// Built with concatenation so the literal "${...}" tokens are not flagged by the
// no-template-curly-in-string lint; the values are alert template placeholders.
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

// The mapping consumes the schema's OUTPUT (defaults applied, notebook alias
// folded), so fixtures go through the schema like real apply input does.
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

/** Split a CcRuleInput back into the { name, namespace, spec } shape CC's API
 * actually returns, i.e. Pick<CcRule, "namespace" | "name" | "spec">. */
function asRule(
  input: CcRuleInput,
): Pick<CcRule, "namespace" | "name" | "spec"> {
  const { name, namespace, ...spec } = input;
  return { name, namespace, spec };
}

describe("toRuleInput", () => {
  it("stamps first-class identity (name/namespace) and drops identity annotations", () => {
    const input = toRuleInput(rule, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(input.name).toBe("default/high-5xx");
    expect(input.namespace).toBe("");
    expect(input.annotations["everr.name"]).toBeUndefined();
    expect(input.annotations["everr.project"]).toBeUndefined();
    expect(input.annotations["everr.repoid"]).toBe("repo-1");
    expect(input.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/default/high-5xx",
    );
  });

  it("maps fields, defaults, and the ownership annotation", () => {
    const input = toRuleInput(rule, "repo-1");
    expect(input.sql).toBe(rule.spec.query);
    expect(input.interval_secs).toBe(300);
    expect(input.for_secs).toBe(0);
    expect(input.resolve_after).toBe(1);
    expect(input.value_column).toBeNull();
    expect(input.label_columns).toEqual(["route"]);
    expect(input.severity).toBe("warning");
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(input.annotations.summary).toBe(TITLE_TEMPLATE);
    expect(input.annotations["everr.label.team"]).toBe("platform");
  });

  it("maps for/resolveAfter/valueColumn onto the CC input", () => {
    const input = toRuleInput(
      parseRule({ for: "10m", resolveAfter: 3, valueColumn: "count" }),
      "repo-1",
    );
    expect(input.for_secs).toBe(600);
    expect(input.resolve_after).toBe(3);
    expect(input.value_column).toBe("count");
  });

  it("omits the description annotations when the message has none", () => {
    const input = toRuleInput(
      parseRule({ notificationMessage: { title: TITLE_TEMPLATE } }),
      "repo-1",
    );
    expect(input.annotations.description).toBeUndefined();
  });

  it("builds an absolute link.runbook when appBaseUrl is provided", () => {
    const input = toRuleInput(
      parseRule({ runbook: "payments/triage-5xx" }),
      "repo-1",
      { appBaseUrl: "https://app.example.com" },
    );
    expect(input.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/payments/triage-5xx",
    );

    // No base URL (or no runbook) -> no link annotation.
    const without = toRuleInput(
      parseRule({ runbook: "payments/triage-5xx" }),
      "repo-1",
    );
    expect(without.annotations["link.runbook"]).toBeUndefined();
    const noRunbook = toRuleInput(rule, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(noRunbook.annotations["link.runbook"]).toBeUndefined();
  });

  it("round-trips through fromCcRule", () => {
    const view = fromCcRule(
      asRule(
        toRuleInput(
          parseRule({ for: "1d", resolveAfter: 2, valueColumn: "count" }),
          "repo-1",
        ),
      ),
    );
    expect(view).toMatchObject({
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
  });

  it("parses project/slug off the CC name", () => {
    const { name, namespace, ...spec } = toRuleInput(rule, "repo-1");
    void name;
    void namespace;
    const view = fromCcRule({
      namespace: "",
      name: "payments/checkout",
      spec,
    });
    expect(view.project).toBe("payments");
    expect(view.slug).toBe("checkout");
  });

  it("carries a linked runbook via the everr.runbook annotation", () => {
    // Bare slug resolves against the alert's own project ("default" here).
    const bare = toRuleInput(parseRule({ runbook: "triage-5xx" }), "repo-1");
    expect(bare.annotations["everr.runbook"]).toBe("triage-5xx");
    expect(fromCcRule(asRule(bare))).toMatchObject({
      runbookProject: "default",
      runbookSlug: "triage-5xx",
    });

    // A project-qualified ref is stored and read back canonically.
    const scoped = toRuleInput(
      parseRule({ runbook: "payments/triage-5xx" }, { project: "payments" }),
      "repo-1",
    );
    expect(scoped.annotations["everr.runbook"]).toBe("payments/triage-5xx");
    expect(fromCcRule(asRule(scoped))).toMatchObject({
      runbookProject: "payments",
      runbookSlug: "triage-5xx",
    });
  });

  it("leaves the runbook unset when the alert links none", () => {
    const view = fromCcRule(asRule(toRuleInput(rule, "repo-1")));
    expect(view.runbookProject).toBeNull();
    expect(view.runbookSlug).toBeNull();
  });

  it("builds a suppressed rule in the preview namespace, with no identity annotation", () => {
    const input = toRuleInput(rule, "repo-1", { previewId: "prev-1" });
    // CC evaluates the rule fully but the dispatcher never notifies on it.
    expect(input.namespace).toBe("prev-1");
    expect(input.suppressed).toBe(true);
    expect(input.annotations["everr.preview"]).toBeUndefined();
    expect(previewIdOf({ namespace: input.namespace })).toBe("prev-1");
    // Ownership is unchanged: same repo, same name, still owned.
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(isOwnedRule(asRule(input), "repo-1")).toBe(true);
    // Round-trip.
    const view = fromCcRule(asRule(input));
    expect(view.previewId).toBe("prev-1");
    expect(view.suppressed).toBe(true);
  });

  it("live rules are not suppressed and use the empty namespace", () => {
    const input = toRuleInput(rule, "repo-1");
    expect(input.suppressed).toBe(false);
    expect(input.namespace).toBe("");
    expect(previewIdOf({ namespace: input.namespace })).toBeNull();
    const view = fromCcRule(asRule(input));
    expect(view.previewId).toBeNull();
    expect(view.suppressed).toBe(false);
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
    // Generated keys are untouched by the merge.
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
    // A bare CC rule (no everr.repoid) is never owned, regardless of repoid.
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

    // The reconstructed document is valid as-code input...
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

    // ...and mapping it forward again reproduces the original CC rule input.
    expect(toRuleInput(reparsed, "repo-1")).toEqual(ruleInput);
  });

  it("omits the project when it is the default project", () => {
    const doc = toAlertRuleDocument(asRule(toRuleInput(parseRule(), "repo-1")));
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.metadata.project).toBeUndefined();
  });

  it("recovers a non-default project from the CC name", () => {
    const doc = toAlertRuleDocument(
      asRule(toRuleInput(parseRule({}, { project: "payments" }), "repo-1")),
    );
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.metadata.project).toBe("payments");
    expect(json.metadata.name).toBe("high-5xx");
  });

  it("omits optional fields that the spec does not carry", () => {
    const doc = toAlertRuleDocument(asRule(toRuleInput(parseRule(), "repo-1")));
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.spec.runbook).toBeUndefined();
    expect(json.spec.valueColumn).toBeUndefined();
    expect(json.spec.maxInterval).toBeUndefined();
    expect(json.spec.annotations).toBeUndefined();
    expect(json.spec.display).toEqual(baseInput.spec.display);
    expect(AlertRuleYamlSchema.parse(json).spec.for).toBe("0s");
  });
});
