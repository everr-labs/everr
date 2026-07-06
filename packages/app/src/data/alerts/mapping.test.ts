import { describe, expect, it } from "vitest";
import {
  fromCcRuleSpec,
  isManagedSimple,
  MANAGED_SIMPLE,
  OWN_MANAGED,
  OWN_NAME,
  OWN_PREVIEW,
  OWN_REPO,
  previewIdOf,
  toSimpleRuleSpec,
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

describe("toSimpleRuleSpec", () => {
  it("maps fields, defaults, and ownership annotations", () => {
    const spec = toSimpleRuleSpec(rule, "repo-1");
    expect(spec.sql).toBe(rule.spec.query);
    expect(spec.interval_secs).toBe(300);
    expect(spec.for_secs).toBe(0);
    expect(spec.resolve_after).toBe(1);
    expect(spec.value_column).toBeNull();
    expect(spec.label_columns).toEqual(["route"]);
    expect(spec.severity).toBe("warning");
    expect(spec.annotations[OWN_NAME]).toBe("high-5xx");
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
    expect(spec.annotations[OWN_MANAGED]).toBe(MANAGED_SIMPLE);
    expect(spec.annotations["everr.notification.title"]).toBe(TITLE_TEMPLATE);
    expect(spec.annotations["everr.label.team"]).toBe("platform");
  });

  it("maps for/resolveAfter/valueColumn onto the CC spec", () => {
    const spec = toSimpleRuleSpec(
      parseRule({ for: "10m", resolveAfter: 3, valueColumn: "count" }),
      "repo-1",
    );
    expect(spec.for_secs).toBe(600);
    expect(spec.resolve_after).toBe(3);
    expect(spec.value_column).toBe("count");
  });

  it("packs the CC notification-rendering annotations", () => {
    const spec = toSimpleRuleSpec(rule, "repo-1");
    // The dispatcher renders `summary` as the headline and `description` as an
    // extra body line, substituting ${label} / ${value}.
    expect(spec.annotations.summary).toBe(TITLE_TEMPLATE);
    expect(spec.annotations.description).toBe(DESC_TEMPLATE);
  });

  it("omits the description annotations when the message has none", () => {
    const spec = toSimpleRuleSpec(
      parseRule({ notificationMessage: { title: TITLE_TEMPLATE } }),
      "repo-1",
    );
    expect(spec.annotations.description).toBeUndefined();
    expect(spec.annotations["everr.notification.description"]).toBeUndefined();
  });

  it("builds an absolute link.runbook when appBaseUrl is provided", () => {
    const spec = toSimpleRuleSpec(
      parseRule({ runbook: "payments/triage-5xx" }),
      "repo-1",
      { appBaseUrl: "https://app.example.com" },
    );
    expect(spec.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/payments/triage-5xx",
    );

    // No base URL (or no runbook) -> no link annotation.
    const without = toSimpleRuleSpec(
      parseRule({ runbook: "payments/triage-5xx" }),
      "repo-1",
    );
    expect(without.annotations["link.runbook"]).toBeUndefined();
    const noRunbook = toSimpleRuleSpec(rule, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(noRunbook.annotations["link.runbook"]).toBeUndefined();
  });

  it("round-trips through fromCcRuleSpec", () => {
    const view = fromCcRuleSpec(
      toSimpleRuleSpec(
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
    const bare = toSimpleRuleSpec(
      parseRule({ runbook: "triage-5xx" }),
      "repo-1",
    );
    expect(bare.annotations["everr.runbook"]).toBe("triage-5xx");
    expect(fromCcRuleSpec(bare)).toMatchObject({
      runbookProject: "default",
      runbookSlug: "triage-5xx",
    });

    // A project-qualified ref is stored and read back canonically.
    const scoped = toSimpleRuleSpec(
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
    const view = fromCcRuleSpec(toSimpleRuleSpec(rule, "repo-1"));
    expect(view.runbookProject).toBeNull();
    expect(view.runbookSlug).toBeNull();
  });

  it("builds a suppressed, preview-tagged spec for a preview namespace", () => {
    const spec = toSimpleRuleSpec(rule, "repo-1", { previewId: "prev-1" });
    // CC evaluates the rule fully but the dispatcher never notifies on it.
    expect(spec.suppressed).toBe(true);
    expect(spec.annotations[OWN_PREVIEW]).toBe("prev-1");
    expect(previewIdOf(spec)).toBe("prev-1");
    // Ownership is unchanged: same repo, same name, still managed-simple.
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
    expect(isManagedSimple(spec, "repo-1")).toBe(true);
    // Round-trip.
    const view = fromCcRuleSpec(spec);
    expect(view.previewId).toBe("prev-1");
    expect(view.suppressed).toBe(true);
  });

  it("live specs are not suppressed and carry no preview annotation", () => {
    const spec = toSimpleRuleSpec(rule, "repo-1");
    expect(spec.suppressed).toBe(false);
    expect(spec.annotations[OWN_PREVIEW]).toBeUndefined();
    expect(previewIdOf(spec)).toBeNull();
    const view = fromCcRuleSpec(spec);
    expect(view.previewId).toBeNull();
    expect(view.suppressed).toBe(false);
  });
});

describe("withAlertLink", () => {
  it("stamps link.alert with the alert detail URL, keeping the rest intact", () => {
    const spec = toSimpleRuleSpec(rule, "repo-1");
    const linked = withAlertLink(spec, "https://app.example.com", "rule-123");
    expect(linked.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rule-123",
    );
    // Non-mutating, and everything else is unchanged.
    expect(spec.annotations["link.alert"]).toBeUndefined();
    expect(linked.sql).toBe(spec.sql);
    expect(linked.annotations[OWN_NAME]).toBe("high-5xx");
  });
});

describe("isManagedSimple", () => {
  it("requires the managed marker and (optionally) the repo", () => {
    const spec = toSimpleRuleSpec(rule, "repo-1");
    expect(isManagedSimple(spec)).toBe(true);
    expect(isManagedSimple(spec, "repo-1")).toBe(true);
    expect(isManagedSimple(spec, "repo-2")).toBe(false);
    expect(isManagedSimple({ ...spec, annotations: {} } as never)).toBe(false);
  });
});
