import { describe, expect, it } from "vitest";
import type { CcSlo, CcSloInput } from "@/data/cc/types";
import {
  fromCcSlo,
  isOwnedSlo,
  OWN_REPO,
  previewIdOfSlo,
  toSloDocument,
  toSloInput,
} from "./mapping";
import { SloYamlSchema } from "./schema";

const SQL =
  "SELECT countIf(ok) AS good, count() AS valid FROM t " +
  "WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}";

function sloYaml(
  spec: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
) {
  return SloYamlSchema.parse({
    kind: "SLO",
    metadata: { name: "checkout", ...metadata },
    spec: {
      sli: { sql: SQL, labelColumns: ["service"] },
      targetPercent: 99.9,
      timeWindow: "30d",
      ...spec,
    },
  });
}

/** Split a CcSloInput back into the { namespace, name, spec } shape CC's API
 * actually returns, i.e. Pick<CcSlo, "namespace" | "name" | "spec">. */
function asSlo(input: CcSloInput): Pick<CcSlo, "namespace" | "name" | "spec"> {
  const { name, namespace, ...spec } = input;
  return { name, namespace, spec };
}

describe("toSloInput", () => {
  it("stamps first-class identity and ownership", () => {
    const input = toSloInput(sloYaml(), "repo-1");
    expect(input.name).toBe("default/checkout");
    expect(input.namespace).toBe("");
    expect(input.annotations["everr.repoid"]).toBe("repo-1");
  });

  it("maps the spec fields, defaults, and the ownership annotation", () => {
    const input = toSloInput(
      sloYaml({ minValidEvents: 1000, annotations: { team: "payments" } }),
      "repo-1",
    );
    expect(input.sli).toEqual({ sql: SQL, label_columns: ["service"] });
    expect(input.targetPercent).toBe(99.9);
    expect(input.timeWindow).toEqual({ duration: "30d", isRolling: true });
    expect(input.min_valid_events).toBe(1000);
    expect(input).not.toHaveProperty("tiers");
    expect(input.suppressed).toBe(false);
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(input.annotations.team).toBe("payments");
  });

  it("defaults label_columns and omits optional fields for a minimal document", () => {
    const minimal = SloYamlSchema.parse({
      kind: "SLO",
      metadata: { name: "checkout" },
      spec: { sli: { sql: SQL }, targetPercent: 99.9, timeWindow: "30d" },
    });
    const input = toSloInput(minimal, "repo-1");
    expect(input.sli.label_columns).toEqual([]);
    expect(input).not.toHaveProperty("min_valid_events");
  });

  it("stamps everr.label.<k> from metadata.labels", () => {
    const input = toSloInput(
      sloYaml({}, { labels: { team: "payments" } }),
      "repo-1",
    );
    expect(input.annotations["everr.label.team"]).toBe("payments");
  });

  it("builds an absolute link.runbook when appBaseUrl is provided", () => {
    const input = toSloInput(
      sloYaml({ runbook: "checkout-triage" }),
      "repo-1",
      {
        appBaseUrl: "https://app.example.com",
      },
    );
    expect(input.name).toBe("default/checkout");
    expect(input.namespace).toBe("");
    expect(input.annotations["everr.runbook"]).toBe("checkout-triage");
    expect(input.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/default/checkout-triage",
    );

    // No base URL (or no runbook) -> no link annotation.
    const without = toSloInput(
      sloYaml({ runbook: "checkout-triage" }),
      "repo-1",
    );
    expect(without.annotations["link.runbook"]).toBeUndefined();
    const noRunbook = toSloInput(sloYaml(), "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(noRunbook.annotations["link.runbook"]).toBeUndefined();
  });

  it("stores a project-qualified runbook ref canonically", () => {
    const input = toSloInput(
      sloYaml({ runbook: "payments/checkout-triage" }, { project: "payments" }),
      "repo-1",
    );
    expect(input.annotations["everr.runbook"]).toBe("payments/checkout-triage");
  });

  it("resolves a bare runbook slug against the SLO's own (non-default) project", () => {
    const input = toSloInput(
      sloYaml({ runbook: "checkout-triage" }, { project: "payments" }),
      "repo-1",
    );
    expect(input.annotations["everr.runbook"]).toBe("payments/checkout-triage");
  });

  it("builds preview SLOs suppressed and namespaced", () => {
    const input = toSloInput(sloYaml(), "repo-1", { previewId: "pv-1" });
    expect(input.namespace).toBe("pv-1");
    expect(input.suppressed).toBe(true);
    // Ownership is unchanged: same repo, still owned.
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(isOwnedSlo(asSlo(input), "repo-1")).toBe(true);
    expect(previewIdOfSlo({ namespace: input.namespace })).toBe("pv-1");
  });

  it("live SLOs are not suppressed and use the empty namespace", () => {
    const input = toSloInput(sloYaml(), "repo-1");
    expect(input.suppressed).toBe(false);
    expect(input.namespace).toBe("");
    expect(previewIdOfSlo({ namespace: input.namespace })).toBeNull();
  });

  it("stamps display annotations and a summary derived from the display name", () => {
    const input = toSloInput(
      sloYaml({
        display: {
          name: "Checkout availability",
          description: "Orders complete",
        },
      }),
      "repo-1",
    );
    expect(input.annotations["everr.display.name"]).toBe(
      "Checkout availability",
    );
    expect(input.annotations["everr.display.description"]).toBe(
      "Orders complete",
    );
    expect(input.annotations.summary).toBe(
      `Checkout availability: \${slo_tier} burn - \${burn_rate}x over budget`,
    );
  });

  it("stamps only the display fields that are set, and no summary without a display name", () => {
    const nameOnly = toSloInput(
      sloYaml({ display: { name: "Checkout availability" } }),
      "repo-1",
    );
    expect(nameOnly.annotations["everr.display.name"]).toBe(
      "Checkout availability",
    );
    expect(nameOnly.annotations["everr.display.description"]).toBeUndefined();
    expect(nameOnly.annotations.summary).toBe(
      `Checkout availability: \${slo_tier} burn - \${burn_rate}x over budget`,
    );

    const none = toSloInput(sloYaml(), "repo-1");
    expect(none.annotations["everr.display.name"]).toBeUndefined();
    expect(none.annotations["everr.display.description"]).toBeUndefined();
    expect(none.annotations.summary).toBeUndefined();
  });

  it("merges user annotations, generated keys always winning", () => {
    const input = toSloInput(
      sloYaml({ annotations: { team: "platform-eng", owner: "gio" } }),
      "repo-1",
    );
    expect(input.annotations.team).toBe("platform-eng");
    expect(input.annotations.owner).toBe("gio");
    expect(input.name).toBe("default/checkout");
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
  });
});

describe("isOwnedSlo", () => {
  it("requires everr.repoid and (optionally) a matching repo", () => {
    const owned = asSlo(toSloInput(sloYaml(), "repo-1"));
    expect(isOwnedSlo(owned)).toBe(true);
    expect(isOwnedSlo(owned, "repo-1")).toBe(true);
    expect(isOwnedSlo(owned, "repo-2")).toBe(false);
    // A bare CC SLO (no everr.repoid) is never owned, regardless of repoid.
    const unowned = { ...owned, spec: { ...owned.spec, annotations: {} } };
    expect(isOwnedSlo(unowned)).toBe(false);
    expect(isOwnedSlo(unowned, "repo-1")).toBe(false);
  });
});

describe("fromCcSlo", () => {
  it("round-trips project/slug (off the CC name), ownership, and runbook", () => {
    const input = toSloInput(
      sloYaml({ runbook: "checkout-triage" }, { project: "payments" }),
      "repo-1",
    );
    const view = fromCcSlo(asSlo(input));
    expect(view).toMatchObject({
      project: "payments",
      slug: "checkout",
      repoid: "repo-1",
      previewId: null,
      suppressed: false,
      runbookProject: "payments",
      runbookSlug: "checkout-triage",
    });
  });

  it("leaves the runbook unset when the SLO links none", () => {
    const view = fromCcSlo(asSlo(toSloInput(sloYaml(), "repo-1")));
    expect(view.runbookProject).toBeNull();
    expect(view.runbookSlug).toBeNull();
  });

  it("round-trips the preview id and suppressed flag", () => {
    const input = toSloInput(sloYaml(), "repo-1", { previewId: "pv-1" });
    const view = fromCcSlo(asSlo(input));
    expect(view.previewId).toBe("pv-1");
    expect(view.suppressed).toBe(true);
  });

  it("defaults to unmanaged for a bare engine SLO", () => {
    const bare = asSlo(toSloInput(sloYaml(), "repo-1"));
    const unmanaged = { ...bare, spec: { ...bare.spec, annotations: {} } };
    expect(fromCcSlo(unmanaged)).toMatchObject({
      repoid: "",
      previewId: null,
      suppressed: false,
      runbookProject: null,
      runbookSlug: null,
    });
  });

  it("exposes displayName/displayDescription, null when absent", () => {
    const input = toSloInput(
      sloYaml({
        display: {
          name: "Checkout availability",
          description: "Orders complete",
        },
      }),
      "repo-1",
    );
    const view = fromCcSlo(asSlo(input));
    expect(view.displayName).toBe("Checkout availability");
    expect(view.displayDescription).toBe("Orders complete");

    const noDisplay = fromCcSlo(asSlo(toSloInput(sloYaml(), "repo-1")));
    expect(noDisplay.displayName).toBeNull();
    expect(noDisplay.displayDescription).toBeNull();
  });
});

describe("toSloDocument round-trip", () => {
  it("YAML -> CcSloInput -> YAML is identical for a minimal document", () => {
    const doc = sloYaml();
    const input = toSloInput(doc, "repo-1");
    expect(toSloDocument(asSlo(input))).toEqual(doc);
  });

  it("round-trips spec.runbook", () => {
    const doc = sloYaml({ runbook: "checkout-triage" });
    const input = toSloInput(doc, "repo-1");
    expect(toSloDocument(asSlo(input)).spec.runbook).toBe("checkout-triage");
  });

  it("omits the project when it is the default project", () => {
    const doc = toSloDocument(asSlo(toSloInput(sloYaml(), "repo-1")));
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.metadata.project).toBeUndefined();
  });

  it("recovers a non-default project from the CC name", () => {
    const doc = toSloDocument(
      asSlo(toSloInput(sloYaml({}, { project: "payments" }), "repo-1")),
    );
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.metadata.project).toBe("payments");
    expect(json.metadata.name).toBe("checkout");
  });

  it("omits optional fields the spec does not carry", () => {
    const doc = toSloDocument(asSlo(toSloInput(sloYaml(), "repo-1")));
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.spec.runbook).toBeUndefined();
    expect(json.spec.minValidEvents).toBeUndefined();
    expect(json.spec.annotations).toBeUndefined();
  });

  it("round-trips spec.display and leaks none of the display/summary annotations into user annotations", () => {
    const doc = sloYaml({
      display: {
        name: "Checkout availability",
        description: "Orders complete",
      },
      annotations: { team: "payments" },
    });
    const input = toSloInput(doc, "repo-1");
    const slo = asSlo(input);

    const view = fromCcSlo(slo);
    expect(view.displayName).toBe("Checkout availability");
    expect(view.displayDescription).toBe("Orders complete");

    const rebuilt = toSloDocument(slo);
    expect(rebuilt.spec.display).toEqual({
      name: "Checkout availability",
      description: "Orders complete",
    });
    expect(rebuilt.spec.annotations).toEqual({ team: "payments" });
    const annotationKeys = Object.keys(rebuilt.spec.annotations ?? {});
    expect(annotationKeys).not.toContain("summary");
    expect(annotationKeys.some((k) => k.startsWith("everr."))).toBe(false);
  });

  it("omits spec.display when absent", () => {
    const doc = toSloDocument(asSlo(toSloInput(sloYaml(), "repo-1")));
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.spec.display).toBeUndefined();
  });

  it("keeps the generated link.runbook out of a round-tripped, runbook-linked SLO in a non-default project", () => {
    const doc = sloYaml(
      { runbook: "checkout-triage", annotations: { team: "payments" } },
      { project: "payments" },
    );
    const input = toSloInput(doc, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    const slo = asSlo(input);
    // Sanity: the generated link annotation is actually on the wire payload.
    expect(input.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/payments/checkout-triage",
    );

    const view = fromCcSlo(slo);
    expect(view.runbookProject).toBe("payments");
    expect(view.runbookSlug).toBe("checkout-triage");

    const rebuilt = toSloDocument(slo);
    expect(rebuilt.spec.runbook).toBe("payments/checkout-triage");
    expect(rebuilt.spec.annotations).toEqual({ team: "payments" });
    const annotationKeys = Object.keys(rebuilt.spec.annotations ?? {});
    expect(annotationKeys).not.toContain("link.runbook");
    expect(annotationKeys.some((k) => k.startsWith("everr."))).toBe(false);
  });
});
