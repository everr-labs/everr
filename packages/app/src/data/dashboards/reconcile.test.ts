import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";
import type { Dashboard } from "./schema";

const doc = (n: number, slug = "d"): Dashboard =>
  ({
    kind: "Dashboard",
    metadata: { name: slug },
    spec: { panels: {}, layouts: [], _v: n },
  }) as unknown as Dashboard;

describe("reconcile", () => {
  it("creates desired dashboards that don't exist", () => {
    const diff = reconcile({
      existing: [],
      desired: [{ slug: "a", folderPath: "Team", document: doc(1, "a") }],
    });
    expect(diff.creates).toEqual([
      { slug: "a", folderPath: "Team", document: doc(1, "a") },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("deletes existing dashboards absent from the desired set", () => {
    const diff = reconcile({
      existing: [{ slug: "gone", folderPath: "", document: doc(1, "gone") }],
      desired: [],
    });
    expect(diff.deletes).toEqual(["gone"]);
    expect(diff.creates).toEqual([]);
    expect(diff.updates).toEqual([]);
  });

  it("updates when document or folderPath changed, skips when identical", () => {
    const diff = reconcile({
      existing: [
        { slug: "same", folderPath: "X", document: doc(1, "same") },
        { slug: "moved", folderPath: "X", document: doc(1, "moved") },
        { slug: "edited", folderPath: "X", document: doc(1, "edited") },
      ],
      desired: [
        { slug: "same", folderPath: "X", document: doc(1, "same") },
        { slug: "moved", folderPath: "Y", document: doc(1, "moved") },
        { slug: "edited", folderPath: "X", document: doc(2, "edited") },
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
          document: {
            kind: "Dashboard",
            metadata: { name: "a" },
            spec: { panels: {}, layouts: [], x: 1, y: 2 },
          } as unknown as Dashboard,
        },
      ],
      desired: [
        {
          slug: "a",
          folderPath: "",
          document: {
            metadata: { name: "a" },
            kind: "Dashboard",
            spec: { panels: {}, layouts: [], y: 2, x: 1 },
          } as unknown as Dashboard,
        },
      ],
    });
    expect(diff.updates).toEqual([]);
  });
});
