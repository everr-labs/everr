import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";

const doc = (n: number, slug = "d") => ({
  kind: "Dashboard",
  metadata: { name: slug },
  spec: { panels: {}, layouts: [], _v: n },
});

describe("reconcile", () => {
  it("creates desired dashboards that don't exist", () => {
    const diff = reconcile({
      existing: [],
      desired: [
        {
          project: "default",
          slug: "a",
          folderPath: "Team",
          document: doc(1, "a"),
        },
      ],
    });
    expect(diff.creates).toEqual([
      {
        project: "default",
        slug: "a",
        folderPath: "Team",
        document: doc(1, "a"),
      },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("deletes existing dashboards absent from the desired set", () => {
    const diff = reconcile({
      existing: [
        {
          project: "default",
          slug: "gone",
          folderPath: "",
          document: doc(1, "gone"),
        },
      ],
      desired: [],
    });
    expect(diff.deletes).toEqual([{ project: "default", slug: "gone" }]);
    expect(diff.creates).toEqual([]);
    expect(diff.updates).toEqual([]);
  });

  it("keys identity by (project, slug): same slug in two projects is independent", () => {
    const diff = reconcile({
      existing: [
        { project: "a", slug: "d", folderPath: "", document: doc(1, "d") },
      ],
      desired: [
        { project: "a", slug: "d", folderPath: "", document: doc(1, "d") },
        { project: "b", slug: "d", folderPath: "", document: doc(1, "d") },
      ],
    });
    expect(diff.creates).toEqual([
      { project: "b", slug: "d", folderPath: "", document: doc(1, "d") },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("updates when document or folderPath changed, skips when identical", () => {
    const diff = reconcile({
      existing: [
        {
          project: "p",
          slug: "same",
          folderPath: "X",
          document: doc(1, "same"),
        },
        {
          project: "p",
          slug: "moved",
          folderPath: "X",
          document: doc(1, "moved"),
        },
        {
          project: "p",
          slug: "edited",
          folderPath: "X",
          document: doc(1, "edited"),
        },
      ],
      desired: [
        {
          project: "p",
          slug: "same",
          folderPath: "X",
          document: doc(1, "same"),
        },
        {
          project: "p",
          slug: "moved",
          folderPath: "Y",
          document: doc(1, "moved"),
        },
        {
          project: "p",
          slug: "edited",
          folderPath: "X",
          document: doc(2, "edited"),
        },
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
          project: "p",
          slug: "a",
          folderPath: "",
          document: {
            kind: "Dashboard",
            metadata: { name: "a" },
            spec: { panels: {}, layouts: [], x: 1, y: 2 },
          },
        },
      ],
      desired: [
        {
          project: "p",
          slug: "a",
          folderPath: "",
          document: {
            metadata: { name: "a" },
            kind: "Dashboard",
            spec: { panels: {}, layouts: [], y: 2, x: 1 },
          },
        },
      ],
    });
    expect(diff.updates).toEqual([]);
  });

  it("keys project and slug unambiguously when a value contains the separator", () => {
    // With a space separator, ("a","b c") and ("a b","c") both key to "a b c"
    // and would be treated as the same resource. They must stay distinct.
    const diff = reconcile({
      existing: [
        { project: "a", slug: "b c", folderPath: "", document: doc(1, "b c") },
      ],
      desired: [
        { project: "a b", slug: "c", folderPath: "", document: doc(1, "c") },
      ],
    });
    expect(diff.creates.map((c) => c.slug)).toEqual(["c"]);
    expect(diff.deletes).toEqual([{ project: "a", slug: "b c" }]);
    expect(diff.updates).toEqual([]);
  });

  it("compares documents with null fields without throwing", () => {
    // typeof null === "object": an unguarded sortKeys would call Object.keys(null).
    const make = (extra: unknown) => ({
      project: "p",
      slug: "a",
      folderPath: "",
      document: { kind: "Dashboard", metadata: { name: "a" }, extra },
    });
    expect(
      reconcile({ existing: [make(null)], desired: [make(null)] }).updates,
    ).toEqual([]);
    expect(
      reconcile({ existing: [make(null)], desired: [make(1)] }).updates,
    ).toHaveLength(1);
  });
});
