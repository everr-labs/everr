import { describe, expect, it } from "vitest";
import { overlayPreview } from "./overlay";

const r = (
  repoid: string,
  slug: string,
  doc: unknown = { v: 1 },
  folderPath = "",
) => ({ repoid, project: "default", slug, folderPath, document: doc });

const covered = new Set(["repo-1"]);

describe("overlayPreview", () => {
  it("passes live rows of uncovered repoids through untagged", () => {
    const out = overlayPreview({
      live: [r("repo-2", "other")],
      previewRows: [],
      coveredRepoids: covered,
    });
    expect(out).toEqual([r("repo-2", "other")]);
    expect(out[0].previewStatus).toBeUndefined();
  });

  it("tags added, changed, unchanged, and removed", () => {
    const out = overlayPreview({
      live: [
        r("repo-1", "changed", { v: 1 }),
        r("repo-1", "unchanged"),
        r("repo-1", "removed"),
      ],
      previewRows: [
        r("repo-1", "added"),
        r("repo-1", "changed", { v: 2 }),
        r("repo-1", "unchanged"),
      ],
      coveredRepoids: covered,
    });
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
    const out = overlayPreview({
      live: [
        r("repo-1", "moved", { a: 1, b: 2 }, "old"),
        r("repo-1", "same", { a: 1, b: 2 }),
      ],
      previewRows: [
        r("repo-1", "moved", { a: 1, b: 2 }, "new"),
        // Key order differs; stable-stringify must call them equal.
        r("repo-1", "same", { b: 2, a: 1 }),
      ],
      coveredRepoids: covered,
    });
    const byStatus = Object.fromEntries(
      out.map((row) => [row.slug, row.previewStatus]),
    );
    expect(byStatus).toEqual({ moved: "changed", same: "unchanged" });
  });

  it("a same-identity live row in an uncovered repoid does not shadow the preview row", () => {
    const out = overlayPreview({
      live: [r("repo-2", "dup")],
      previewRows: [r("repo-1", "dup")],
      coveredRepoids: covered,
    });
    expect(out).toHaveLength(2);
    expect(out.find((row) => row.repoid === "repo-1")?.previewStatus).toBe(
      "added",
    );
    expect(
      out.find((row) => row.repoid === "repo-2")?.previewStatus,
    ).toBeUndefined();
  });
});
