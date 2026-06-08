import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";

const spec = (n: number) => ({ panels: {}, layouts: [], _v: n });

describe("reconcile", () => {
  it("creates desired dashboards that don't exist", () => {
    const diff = reconcile({
      existing: [],
      desired: [{ slug: "a", folderPath: "Team", spec: spec(1) }],
    });
    expect(diff.creates).toEqual([
      { slug: "a", folderPath: "Team", spec: spec(1) },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("deletes existing dashboards absent from the desired set", () => {
    const diff = reconcile({
      existing: [{ slug: "gone", folderPath: "", spec: spec(1) }],
      desired: [],
    });
    expect(diff.deletes).toEqual(["gone"]);
    expect(diff.creates).toEqual([]);
    expect(diff.updates).toEqual([]);
  });

  it("updates when spec or folderPath changed, skips when identical", () => {
    const diff = reconcile({
      existing: [
        { slug: "same", folderPath: "X", spec: spec(1) },
        { slug: "moved", folderPath: "X", spec: spec(1) },
        { slug: "edited", folderPath: "X", spec: spec(1) },
      ],
      desired: [
        { slug: "same", folderPath: "X", spec: spec(1) },
        { slug: "moved", folderPath: "Y", spec: spec(1) },
        { slug: "edited", folderPath: "X", spec: spec(2) },
      ],
    });
    expect(diff.updates.map((u) => u.slug).sort()).toEqual(["edited", "moved"]);
    expect(diff.creates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("does not update when only key order differs", () => {
    const diff = reconcile({
      existing: [
        {
          slug: "a",
          folderPath: "",
          spec: { panels: {}, layouts: [], x: 1, y: 2 },
        },
      ],
      desired: [
        {
          slug: "a",
          folderPath: "",
          spec: { panels: {}, layouts: [], y: 2, x: 1 },
        },
      ],
    });
    expect(diff.updates).toEqual([]);
  });
});
