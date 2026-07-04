import { identityKey, stableStringify } from "@/data/as-code/reconcile";

export type PreviewStatus =
  | "added"
  | "changed"
  | "conflict"
  | "removed"
  | "unchanged";

export interface OverlayResource {
  repoid: string;
  project: string;
  slug: string;
  folderPath: string;
  // null marks a live row; a registry id marks a preview row (see `overlayPreview`).
  previewId: string | null;
  document: unknown;
}

// End state of a preview over live: for covered repoids the preview's rows
// replace the live ones (missing preview row = "removed", missing live row =
// "added"); live rows of uncovered repoids pass through untagged; preview rows
// outside the covered set are orphans and dropped. A preview add whose global
// identity (project, slug) is already a live resource owned by a different repo
// is a "conflict" — merging it would fail the cross-repo ownership check.
export function overlayPreview<T extends OverlayResource>(opts: {
  rows: T[];
  coveredRepoids: ReadonlySet<string>;
}): (T & { previewStatus?: PreviewStatus })[] {
  // null = live, a registry id = a preview row.
  const live = opts.rows.filter((row) => row.previewId === null);
  const previewRows = opts.rows.filter((row) => row.previewId !== null);

  // NUL-joined identity key: unambiguous even if a segment contains a separator.
  const key = (row: OverlayResource) =>
    `${row.repoid}\u0000${row.project}\u0000${row.slug}`;
  // Owner-agnostic identity (project, slug): a live match under a *different*
  // owner is a cross-repo clash, not an edit.
  const liveByKey = new Map(live.map((row) => [key(row), row]));
  const liveByIdentity = new Map(live.map((row) => [identityKey(row), row]));
  const previewKeys = new Set(previewRows.map(key));

  const out: (T & { previewStatus?: PreviewStatus })[] = [];
  for (const row of previewRows) {
    // Orphan preview row (repoid the registry doesn't cover) — skip it.
    if (!opts.coveredRepoids.has(row.repoid)) continue;
    const liveRow = liveByKey.get(key(row));
    if (!liveRow) {
      // No same-owner live row. A live resource with this identity under a
      // different owner (same-owner would have matched above) means a merge
      // would collide → conflict; otherwise it's a genuine add.
      const status: PreviewStatus = liveByIdentity.has(identityKey(row))
        ? "conflict"
        : "added";
      out.push({ ...row, previewStatus: status });
    } else if (
      liveRow.folderPath !== row.folderPath ||
      stableStringify(liveRow.document) !== stableStringify(row.document)
    ) {
      out.push({ ...row, previewStatus: "changed" });
    } else {
      out.push({ ...row, previewStatus: "unchanged" });
    }
  }
  for (const row of live) {
    if (!opts.coveredRepoids.has(row.repoid)) {
      out.push(row);
    } else if (!previewKeys.has(key(row))) {
      out.push({ ...row, previewStatus: "removed" });
    }
  }
  return out;
}
