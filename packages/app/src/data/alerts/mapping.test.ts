import { describe, expect, it } from "vitest";
import {
  fromCcRuleSpec,
  isOwnedRule,
  OWN_NAME,
  OWN_PREVIEW,
  OWN_REPO,
  previewIdOf,
  toAlertRuleDocument,
  toRuleSpec,
  withAlertLink,
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

describe("toRuleSpec", () => {
  it("maps fields, defaults, and ownership annotations", () => {
    const spec = toRuleSpec(rule, "repo-1");
    expect(spec.sql).toBe(rule.spec.query);
    expect(spec.interval_secs).toBe(300);
    expect(spec.for_secs).toBe(0);
    expect(spec.resolve_after).toBe(1);
    expect(spec.value_column).toBeNull();
    expect(spec.label_columns).toEqual(["route"]);
    expect(spec.severity).toBe("warning");
    expect(spec.annotations[OWN_NAME]).toBe("high-5xx");
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
    expect(spec.annotations.summary).toBe(TITLE_TEMPLATE);
    expect(spec.annotations["everr.label.team"]).toBe("platform");
  });

  it("maps for/resolveAfter/valueColumn onto the CC spec", () => {
    const spec = toRuleSpec(
      parseRule({ for: "10m", resolveAfter: 3, valueColumn: "count" }),
      "repo-1",
    );
    expect(spec.for_secs).toBe(600);
    expect(spec.resolve_after).toBe(3);
    expect(spec.value_column).toBe("count");
  });

  it("packs the CC notification-rendering annotations", () => {
    const spec = toRuleSpec(rule, "repo-1");
    // The dispatcher renders `summary` as the headline and `description` as an
    // extra body line, substituting ${label} / ${value}.
    expect(spec.annotations.summary).toBe(TITLE_TEMPLATE);
    expect(spec.annotations.description).toBe(DESC_TEMPLATE);
  });

  it("omits the description annotations when the message has none", () => {
    const spec = toRuleSpec(
      parseRule({ notificationMessage: { title: TITLE_TEMPLATE } }),
      "repo-1",
    );
    expect(spec.annotations.description).toBeUndefined();
  });

  it("builds an absolute link.runbook when appBaseUrl is provided", () => {
    const spec = toRuleSpec(
      parseRule({ runbook: "payments/triage-5xx" }),
      "repo-1",
      {
        appBaseUrl: "https://app.example.com",
      },
    );
    expect(spec.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/payments/triage-5xx",
    );

    // No base URL (or no runbook) -> no link annotation.
    const without = toRuleSpec(
      parseRule({ runbook: "payments/triage-5xx" }),
      "repo-1",
    );
    expect(without.annotations["link.runbook"]).toBeUndefined();
    const noRunbook = toRuleSpec(rule, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(noRunbook.annotations["link.runbook"]).toBeUndefined();
  });

  it("round-trips through fromCcRuleSpec", () => {
    const view = fromCcRuleSpec(
      toRuleSpec(
        parseRule({ for: "1d", resolveAfter: 2, valueColumn: "count" }),
        "repo-1",
      ),
    );
    expect(view).toMatchObject({
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

  it("carries a linked runbook via the everr.runbook annotation", () => {
    // Bare slug resolves against the alert's own project ("default" here).
    const bare = toRuleSpec(parseRule({ runbook: "triage-5xx" }), "repo-1");
    expect(bare.annotations["everr.runbook"]).toBe("triage-5xx");
    expect(fromCcRuleSpec(bare)).toMatchObject({
      runbookProject: "default",
      runbookSlug: "triage-5xx",
    });

    // A project-qualified ref is stored and read back canonically.
    const scoped = toRuleSpec(
      parseRule({ runbook: "payments/triage-5xx" }, { project: "payments" }),
      "repo-1",
    );
    expect(scoped.annotations["everr.runbook"]).toBe("payments/triage-5xx");
    expect(fromCcRuleSpec(scoped)).toMatchObject({
      runbookProject: "payments",
      runbookSlug: "triage-5xx",
    });
  });

  it("leaves the runbook unset when the alert links none", () => {
    const view = fromCcRuleSpec(toRuleSpec(rule, "repo-1"));
    expect(view.runbookProject).toBeNull();
    expect(view.runbookSlug).toBeNull();
  });

  it("builds a suppressed, preview-tagged spec for a preview namespace", () => {
    const spec = toRuleSpec(rule, "repo-1", { previewId: "prev-1" });
    // CC evaluates the rule fully but the dispatcher never notifies on it.
    expect(spec.suppressed).toBe(true);
    expect(spec.annotations[OWN_PREVIEW]).toBe("prev-1");
    expect(previewIdOf(spec)).toBe("prev-1");
    // Ownership is unchanged: same repo, same name, still owned.
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
    expect(isOwnedRule(spec, "repo-1")).toBe(true);
    // Round-trip.
    const view = fromCcRuleSpec(spec);
    expect(view.previewId).toBe("prev-1");
    expect(view.suppressed).toBe(true);
  });

  it("live specs are not suppressed and carry no preview annotation", () => {
    const spec = toRuleSpec(rule, "repo-1");
    expect(spec.suppressed).toBe(false);
    expect(spec.annotations[OWN_PREVIEW]).toBeUndefined();
    expect(previewIdOf(spec)).toBeNull();
    const view = fromCcRuleSpec(spec);
    expect(view.previewId).toBeNull();
    expect(view.suppressed).toBe(false);
  });

  it("sets max_interval_secs when maxInterval is set, else omits it", () => {
    const withMax = toRuleSpec(parseRule({ maxInterval: "1h" }), "repo-1");
    expect(withMax.max_interval_secs).toBe(3600);

    const withoutMax = toRuleSpec(rule, "repo-1");
    expect(withoutMax.max_interval_secs).toBeUndefined();
  });

  it("merges user annotations, generated keys always winning", () => {
    const spec = toRuleSpec(
      parseRule({ annotations: { team: "platform-eng", owner: "gio" } }),
      "repo-1",
    );
    expect(spec.annotations.team).toBe("platform-eng");
    expect(spec.annotations.owner).toBe("gio");
    // Generated keys are untouched by the merge.
    expect(spec.annotations[OWN_NAME]).toBe("high-5xx");
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
  });
});

describe("withAlertLink", () => {
  it("stamps link.alert with the alert detail URL, keeping the rest intact", () => {
    const spec = toRuleSpec(rule, "repo-1");
    const linked = withAlertLink(spec, "https://app.example.com", "rule-123");
    expect(linked.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/rule-123",
    );
    // Non-mutating, and everything else is unchanged.
    expect(spec.annotations["link.alert"]).toBeUndefined();
    expect(linked.sql).toBe(spec.sql);
    expect(linked.annotations[OWN_NAME]).toBe("high-5xx");
  });
});

describe("isOwnedRule", () => {
  it("requires everr.name and (optionally) a matching repo", () => {
    const spec = toRuleSpec(rule, "repo-1");
    expect(isOwnedRule(spec)).toBe(true);
    expect(isOwnedRule(spec, "repo-1")).toBe(true);
    expect(isOwnedRule(spec, "repo-2")).toBe(false);
    // A bare CC rule (no everr.name) is never owned, regardless of repoid.
    expect(isOwnedRule({ ...spec, annotations: {} } as never)).toBe(false);
    expect(isOwnedRule({ ...spec, annotations: {} } as never, "repo-1")).toBe(
      false,
    );
  });
});

describe("toAlertRuleDocument", () => {
  it("round-trips through the schema and back to an equivalent CC spec", () => {
    const input = parseRule(
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
    const spec = toRuleSpec(input, "repo-1");
    const doc = toAlertRuleDocument(spec);

    // The reconstructed document is valid as-code input...
    const reparsed = AlertRuleYamlSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(reparsed.metadata.name).toBe("high-5xx");
    expect(reparsed.metadata.labels).toEqual({ team: "platform" });
    expect(reparsed.spec.display).toEqual(input.spec.display);
    expect(reparsed.spec.runbook).toBe("ops/high-5xx");
    expect(reparsed.spec.evaluationInterval).toBe("5m");
    expect(reparsed.spec.for).toBe("10m");
    expect(reparsed.spec.resolveAfter).toBe(3);
    expect(reparsed.spec.maxInterval).toBe("1h");
    expect(reparsed.spec.annotations).toEqual({ "team.pager": "platform" });

    // ...and mapping it forward again reproduces the original CC spec.
    expect(toRuleSpec(reparsed, "repo-1")).toEqual(spec);
  });

  it("omits optional fields that the spec does not carry", () => {
    const doc = toAlertRuleDocument(toRuleSpec(parseRule(), "repo-1"));
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.spec.runbook).toBeUndefined();
    expect(json.spec.valueColumn).toBeUndefined();
    expect(json.spec.maxInterval).toBeUndefined();
    expect(json.spec.annotations).toBeUndefined();
    expect(json.spec.display).toEqual(baseInput.spec.display);
    expect(AlertRuleYamlSchema.parse(json).spec.for).toBe("0s");
  });
});
