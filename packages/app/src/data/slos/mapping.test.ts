import { describe, expect, it } from "vitest";
import type { AlertingSlo, AlertingSloInput } from "@/data/alerting/types";
import {
  fromAlertingSlo,
  isOwnedSlo,
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
      sli: { sql: SQL },
      targetPercent: 99.9,
      timeWindow: "30d",
      ...spec,
    },
  });
}

/** Convert an input into the returned SLO shape. */
function asSlo(
  input: AlertingSloInput,
): Pick<AlertingSlo, "previewId" | "repoid" | "name" | "spec"> {
  const { name, repoid, previewId, ...spec } = input;
  return { name, repoid, previewId, spec };
}

describe("toSloInput", () => {
  it("maps the spec fields, first-class identity, labels, and the ownership annotation", () => {
    const input = toSloInput(
      sloYaml(
        { minValidEvents: 1000, annotations: { team: "payments" } },
        { labels: { squad: "checkout" } },
      ),
      "repo-1",
    );
    expect(input.name).toBe("default/checkout");
    expect(input.previewId).toBeNull();
    expect(input.sli).toEqual({ sql: SQL });
    expect(input.targetPercent).toBe(99.9);
    expect(input.timeWindow).toEqual({ duration: "30d", isRolling: true });
    expect(input.min_valid_events).toBe(1000);
    expect(input).not.toHaveProperty("tiers");
    expect(input.suppressed).toBe(false);
    expect(input.repoid).toBe("repo-1");
    expect(input.annotations["everr.label.squad"]).toBe("checkout");
    expect(input.annotations.team).toBe("payments");
  });

  it("stores runbook refs canonically, with an absolute link when appBaseUrl is given", () => {
    const withLink = toSloInput(sloYaml({ runbook: "checkout-triage" }), "r", {
      appBaseUrl: "https://app.example.com",
    });
    expect(withLink.annotations["everr.runbook"]).toBe("checkout-triage");
    expect(withLink.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/default/checkout-triage",
    );

    // A bare slug resolves against the SLO's own (non-default) project, and an
    // already-qualified ref is stored as written.
    for (const runbook of ["checkout-triage", "payments/checkout-triage"]) {
      const input = toSloInput(
        sloYaml({ runbook }, { project: "payments" }),
        "r",
      );
      expect(input.annotations["everr.runbook"]).toBe(
        "payments/checkout-triage",
      );
    }
  });

  it("builds suppressed SLOs owned by the Preview", () => {
    const input = toSloInput(sloYaml(), "repo-1", { previewId: "pv-1" });
    expect(input.previewId).toBe("pv-1");
    expect(input.suppressed).toBe(true);
    expect(input.repoid).toBe("repo-1");
    expect(isOwnedSlo(asSlo(input), "repo-1")).toBe(true);
    expect(fromAlertingSlo(asSlo(input)).previewId).toBe("pv-1");
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
});

describe("isOwnedSlo", () => {
  it("matches the first-class repoid", () => {
    const owned = asSlo(toSloInput(sloYaml(), "repo-1"));
    expect(isOwnedSlo(owned)).toBe(true);
    expect(isOwnedSlo(owned, "repo-1")).toBe(true);
    expect(isOwnedSlo(owned, "repo-2")).toBe(false);
  });
});

describe("fromAlertingSlo", () => {
  it("round-trips project/slug (off the alerting engine name), ownership, runbook, and display", () => {
    const input = toSloInput(
      sloYaml(
        {
          runbook: "checkout-triage",
          display: {
            name: "Checkout availability",
            description: "Orders complete",
          },
        },
        { project: "payments" },
      ),
      "repo-1",
    );
    const view = fromAlertingSlo(asSlo(input));
    expect(view).toMatchObject({
      project: "payments",
      slug: "checkout",
      repoid: "repo-1",
      previewId: null,
      suppressed: false,
      runbookProject: "payments",
      runbookSlug: "checkout-triage",
      displayName: "Checkout availability",
      displayDescription: "Orders complete",
    });
  });

  it("round-trips the preview id and suppressed flag", () => {
    const input = toSloInput(sloYaml(), "repo-1", { previewId: "pv-1" });
    const view = fromAlertingSlo(asSlo(input));
    expect(view.previewId).toBe("pv-1");
    expect(view.suppressed).toBe(true);
  });

  it("keeps ownership independent from annotations", () => {
    const bare = asSlo(toSloInput(sloYaml(), "repo-1"));
    const withoutAnnotations = {
      ...bare,
      spec: { ...bare.spec, annotations: {} },
    };
    expect(fromAlertingSlo(withoutAnnotations)).toMatchObject({
      repoid: "repo-1",
      previewId: null,
      suppressed: false,
      runbookProject: null,
      runbookSlug: null,
      displayName: null,
      displayDescription: null,
    });
  });
});

describe("toSloDocument round-trip", () => {
  it("YAML -> AlertingSloInput -> YAML is identical for a minimal document", () => {
    const doc = sloYaml();
    const input = toSloInput(doc, "repo-1");
    expect(toSloDocument(asSlo(input))).toEqual(doc);
  });

  it("recovers every authored field and leaks none of the generated annotations", () => {
    // A maximal document: non-default project, labels, display, runbook and
    // pass-through annotations all have to survive the trip, while the keys
    // toSloInput generates from them (everr.*, summary, link.runbook) fold back
    // into their source fields instead of reappearing as user annotations.
    const doc = sloYaml(
      {
        display: {
          name: "Checkout availability",
          description: "Orders complete",
        },
        runbook: "payments/checkout-triage",
        minValidEvents: 1000,
        annotations: { team: "payments" },
      },
      { project: "payments", labels: { squad: "checkout" } },
    );
    const input = toSloInput(doc, "repo-1", {
      appBaseUrl: "https://app.example.com",
    });
    expect(input.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/payments/checkout-triage",
    );

    expect(toSloDocument(asSlo(input))).toEqual(doc);
  });
});
