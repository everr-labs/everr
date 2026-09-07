import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";

const doc = (n: number, slug = "d") => ({
  kind: "Dashboard",
  metadata: { name: slug },
  spec: { panels: {}, layouts: [], _v: n },
});

describe("reconcile", () => {
  it("creates, updates (document or folderPath), and prunes to converge on the desired set", () => {
    const diff = reconcile({
      existing: [
        { project: "p", slug: "same", folderPath: "X", document: doc(1) },
        { project: "p", slug: "moved", folderPath: "X", document: doc(1) },
        { project: "p", slug: "edited", folderPath: "X", document: doc(1) },
        { project: "p", slug: "gone", folderPath: "X", document: doc(1) },
      ],
      desired: [
        { project: "p", slug: "same", folderPath: "X", document: doc(1) },
        { project: "p", slug: "moved", folderPath: "Y", document: doc(1) },
        { project: "p", slug: "edited", folderPath: "X", document: doc(2) },
        { project: "p", slug: "new", folderPath: "Team", document: doc(1) },
      ],
    });

    expect(diff.creates).toEqual([
      { project: "p", slug: "new", folderPath: "Team", document: doc(1) },
    ]);
    expect(diff.updates.map((u) => u.slug).sort()).toEqual(["edited", "moved"]);
    expect(diff.deletes).toEqual([{ project: "p", slug: "gone" }]);
  });

  it("keys identity by (project, slug), unambiguously when a value contains the separator", () => {
    const diff = reconcile({
      existing: [
        { project: "a", slug: "d", folderPath: "", document: doc(1) },
        // With a space separator, ("a","b c") and ("a b","c") both key to
        // "a b c" and would be treated as the same resource.
        { project: "a", slug: "b c", folderPath: "", document: doc(1) },
      ],
      desired: [
        { project: "a", slug: "d", folderPath: "", document: doc(1) },
        // Same slug in another project: independent, so a create.
        { project: "b", slug: "d", folderPath: "", document: doc(1) },
        { project: "a b", slug: "c", folderPath: "", document: doc(1) },
      ],
    });

    expect(diff.creates.map((c) => `${c.project}/${c.slug}`)).toEqual([
      "b/d",
      "a b/c",
    ]);
    expect(diff.deletes).toEqual([{ project: "a", slug: "b c" }]);
    expect(diff.updates).toEqual([]);
  });

  it("compares documents by stable stringify: key order is not a change, nulls do not throw", () => {
    const reordered = reconcile({
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
    expect(reordered.updates).toEqual([]);

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
