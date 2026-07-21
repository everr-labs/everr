import { describe, expect, it } from "vitest";
import {
  fromCcSloSpec,
  isOwnedSlo,
  previewIdOfSlo,
  toSloDocument,
  toSloSpec,
} from "./mapping";
import { SloYamlSchema } from "./schema";

const SQL =
  "SELECT countIf(ok) AS good, count() AS valid FROM t " +
  "WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}";

const MINIMAL = {
  kind: "SLO",
  metadata: { name: "checkout" },
  spec: {
    sli: { sql: SQL },
    targetPercent: 99.9,
    timeWindow: "30d",
  },
};

const FULL = {
  kind: "SLO",
  metadata: {
    name: "checkout",
    project: "payments",
    labels: { team: "payments" },
  },
  spec: {
    sli: { sql: SQL, labelColumns: ["service"] },
    targetPercent: 99.5,
    timeWindow: "30d",
    minValidEvents: 1000,
    annotations: { runbook: "https://example.com/rb" },
  },
};

describe("toSloSpec", () => {
  it("maps the document to CC's SloSpec with ownership annotations", () => {
    const spec = toSloSpec(SloYamlSchema.parse(FULL), "repo-1");
    expect(spec.sli).toEqual({ sql: SQL, label_columns: ["service"] });
    expect(spec.targetPercent).toBe(99.5);
    expect(spec.timeWindow).toEqual({ duration: "30d", isRolling: true });
    expect(spec.min_valid_events).toBe(1000);
    expect(spec).not.toHaveProperty("tiers");
    expect(spec.suppressed).toBe(false);
    expect(spec.annotations).toEqual({
      runbook: "https://example.com/rb",
      "everr.name": "checkout",
      "everr.repoid": "repo-1",
      "everr.project": "payments",
      "everr.label.team": "payments",
    });
    expect(isOwnedSlo(spec, "repo-1")).toBe(true);
    expect(previewIdOfSlo(spec)).toBeNull();
  });

  it("defaults label_columns and omits optional fields for a minimal document", () => {
    const spec = toSloSpec(SloYamlSchema.parse(MINIMAL), "repo-1");
    expect(spec.sli.label_columns).toEqual([]);
    expect(spec).not.toHaveProperty("min_valid_events");
    expect(spec).not.toHaveProperty("tiers");
    expect(spec.annotations["everr.project"]).toBeUndefined();
  });

  it("builds preview SLOs suppressed and tagged with the preview id", () => {
    const spec = toSloSpec(SloYamlSchema.parse(MINIMAL), "repo-1", {
      previewId: "p1",
    });
    expect(spec.suppressed).toBe(true);
    expect(spec.annotations["everr.preview"]).toBe("p1");
    expect(previewIdOfSlo(spec)).toBe("p1");
  });
});

describe("toSloDocument round-trip", () => {
  it.each([
    ["minimal", MINIMAL],
    ["full", FULL],
  ])("YAML -> SloSpec -> YAML is identical (%s)", (_label, doc) => {
    const parsed = SloYamlSchema.parse(doc);
    const spec = toSloSpec(parsed, "repo-1");
    expect(toSloDocument(spec)).toEqual(doc);
  });

  it("declared project round-trips verbatim, including an explicit default", () => {
    const doc = {
      ...MINIMAL,
      metadata: { name: "checkout", project: "default" },
    };
    const spec = toSloSpec(SloYamlSchema.parse(doc), "repo-1");
    expect(spec.annotations["everr.project"]).toBe("default");
    expect(toSloDocument(spec)).toEqual(doc);
  });
});

describe("fromCcSloSpec", () => {
  it("reads the as-code identity back out of the annotations", () => {
    const spec = toSloSpec(SloYamlSchema.parse(FULL), "repo-1", {
      previewId: "p1",
    });
    expect(fromCcSloSpec(spec)).toEqual({
      slug: "checkout",
      repoid: "repo-1",
      project: "payments",
      previewId: "p1",
      suppressed: true,
    });
  });

  it("defaults to unmanaged/default-project for a bare engine SLO", () => {
    const bare = toSloSpec(SloYamlSchema.parse(MINIMAL), "repo-1");
    const unmanaged = { ...bare, annotations: {} };
    expect(fromCcSloSpec(unmanaged)).toEqual({
      slug: "",
      repoid: "",
      project: "default",
      previewId: null,
      suppressed: false,
    });
    expect(isOwnedSlo(unmanaged)).toBe(false);
    expect(isOwnedSlo(bare)).toBe(true);
    expect(isOwnedSlo(bare, "repo-2")).toBe(false);
  });
});
