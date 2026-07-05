import { describe, expect, it } from "vitest";
import {
  fromCcRuleSpec,
  isManagedSimple,
  MANAGED_SIMPLE,
  OWN_MANAGED,
  OWN_NAME,
  OWN_REPO,
  toSimpleRuleSpec,
} from "./mapping";

// Built with concatenation so the literal "${...}" tokens are not flagged by the
// no-template-curly-in-string lint; the values are alert template placeholders.
const TITLE_TEMPLATE = "$" + "{count} 5xx";
const DESC_TEMPLATE = "on $" + "{route}";

const rule = {
  kind: "AlertRule" as const,
  metadata: { name: "high-5xx", labels: { team: "platform" } },
  spec: {
    display: { name: "High 5xx", description: "Elevated 5xx." },
    evaluationInterval: "5m",
    severity: "warning" as const,
    notificationMessage: { title: TITLE_TEMPLATE, description: DESC_TEMPLATE },
    query: "SELECT route, count() AS count FROM logs GROUP BY route",
    instanceLabels: ["route"],
  },
};

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

  it("round-trips through fromCcRuleSpec", () => {
    const view = fromCcRuleSpec(toSimpleRuleSpec(rule, "repo-1"));
    expect(view).toMatchObject({
      slug: "high-5xx",
      repoid: "repo-1",
      severity: "warning",
      notificationTitleTemplate: TITLE_TEMPLATE,
      notificationDescriptionTemplate: DESC_TEMPLATE,
      displayName: "High 5xx",
      instanceLabelColumns: ["route"],
    });
  });

  it("carries a linked runbook via the everr.runbook annotation", () => {
    // Bare slug resolves against the alert's own project ("default" here).
    const bare = toSimpleRuleSpec(
      { ...rule, spec: { ...rule.spec, runbook: "triage-5xx" } },
      "repo-1",
    );
    expect(bare.annotations["everr.runbook"]).toBe("triage-5xx");
    expect(fromCcRuleSpec(bare)).toMatchObject({
      runbookProject: "default",
      runbookSlug: "triage-5xx",
    });

    // A project-qualified ref is stored and read back canonically.
    const scoped = toSimpleRuleSpec(
      {
        ...rule,
        metadata: { ...rule.metadata, project: "payments" },
        spec: { ...rule.spec, runbook: "payments/triage-5xx" },
      },
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
