import { describe, expect, it } from "vitest";
import { identityKey } from "@/data/as-code/reconcile";
import { overlayPreview } from "./overlay";

const r = (
  repoid: string,
  slug: string,
  doc: unknown = { v: 1 },
  folderPath = "",
  previewId: string | null = null,
) => ({
  repoid,
  project: "default",
  slug,
  folderPath,
  previewId,
  document: doc,
});

// A preview row: same shape as a live row but carrying a registry id.
const p = (
  repoid: string,
  slug: string,
  doc: unknown = { v: 1 },
  folderPath = "",
) => r(repoid, slug, doc, folderPath, "preview-1");

const covered = new Set(["repo-1"]);

// The as-code resource these cases stand in for is a dashboard: identified by
// (project, slug), declared as a document sitting at a folder path.
const overlay = (
  rows: ReturnType<typeof r>[],
  coveredRepoids: ReadonlySet<string>,
) =>
  overlayPreview({
    rows,
    coveredRepoids,
    identity: identityKey,
    content: (row) => [row.folderPath, row.document],
  });

describe("overlayPreview", () => {
  it("passes live rows of uncovered repoids through untagged", () => {
    const out = overlay([r("repo-2", "other")], covered);
    expect(out).toEqual([r("repo-2", "other")]);
    expect(out[0].previewStatus).toBeUndefined();
  });

  it("tags added, changed, unchanged, and removed", () => {
    const out = overlay(
      [
        r("repo-1", "changed", { v: 1 }),
        r("repo-1", "unchanged"),
        r("repo-1", "removed"),
        p("repo-1", "added"),
        p("repo-1", "changed", { v: 2 }),
        p("repo-1", "unchanged"),
      ],
      covered,
    );
    const byStatus = Object.fromEntries(
      out.map((row) => [row.slug, row.previewStatus]),
    );
    expect(byStatus).toEqual({
      added: "added",
      changed: "changed",
      unchanged: "unchanged",
      removed: "removed",
    });
  });

  it("treats a folderPath move as changed and compares documents stably", () => {
    const out = overlay(
      [
        r("repo-1", "moved", { a: 1, b: 2 }, "old"),
        r("repo-1", "same", { a: 1, b: 2 }),
        p("repo-1", "moved", { a: 1, b: 2 }, "new"),
        // Key order differs; stable-stringify must call them equal.
        p("repo-1", "same", { b: 2, a: 1 }),
      ],
      covered,
    );
    const byStatus = Object.fromEntries(
      out.map((row) => [row.slug, row.previewStatus]),
    );
    expect(byStatus).toEqual({ moved: "changed", same: "unchanged" });
  });

  it("flags a preview add as a conflict when the identity is live under another owner", () => {
    // (project, slug) is the global identity: a preview "add" of "dup" collides
    // with repo-2's live "dup" — merging it would fail the ownership check.
    const out = overlay([r("repo-2", "dup"), p("repo-1", "dup")], covered);
    expect(out).toHaveLength(2);
    expect(out.find((row) => row.repoid === "repo-1")?.previewStatus).toBe(
      "conflict",
    );
    // repo-2's live row is in an uncovered repoid → passes through untagged.
    expect(
      out.find((row) => row.repoid === "repo-2")?.previewStatus,
    ).toBeUndefined();
  });

  it("tags a preview add with no live identity anywhere as added", () => {
    const out = overlay([p("repo-1", "brand-new")], covered);
    expect(out).toHaveLength(1);
    expect(out[0].previewStatus).toBe("added");
  });

  it("ignores orphan preview rows whose repoid is not covered", () => {
    const out = overlay(
      [r("repo-3", "dup"), p("repo-3", "dup")],
      new Set<string>(),
    );
    expect(out).toEqual([r("repo-3", "dup")]);
    expect(out[0].previewStatus).toBeUndefined();
  });
});
