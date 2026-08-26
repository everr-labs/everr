import { describe, expect, it } from "vitest";
import { collectPanelsMapWarnings } from "./deprecations";
import { buildDesiredSet } from "./desired";

const doc = {
  kind: "Dashboard",
  metadata: { name: "legacy" },
  spec: {
    panels: {
      old: {
        kind: "Panel",
        spec: {
          display: { name: "Old panel" },
          plugin: {
            kind: "TimeSeriesChart",
            spec: { curveType: "monotone", unit: "ms" },
          },
          queries: [],
        },
      },
      fine: {
        kind: "Panel",
        spec: {
          display: { name: "Fine panel" },
          plugin: { kind: "TimeSeriesChart", spec: { curveType: "stepAfter" } },
          queries: [],
        },
      },
    },
    layouts: [],
  },
};

describe("deprecated options on the apply path", () => {
  // The whole point of deprecating rather than removing: a stored file that
  // predates the change keeps applying.
  it("does not fail validation", () => {
    expect(() =>
      buildDesiredSet([{ path: "everr/legacy.dashboard.yaml", document: doc }]),
    ).not.toThrow();
  });

  it("reports one warning naming the file and panel", () => {
    const warnings = collectPanelsMapWarnings(
      "everr/legacy.dashboard.yaml",
      doc,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("everr/legacy.dashboard.yaml");
    expect(warnings[0]).toContain('panel "old"');
    expect(warnings[0]).toContain("monotone");
  });
});
