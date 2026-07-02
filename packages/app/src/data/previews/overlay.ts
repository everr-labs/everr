import { stableStringify } from "@/data/as-code/reconcile";

export type PreviewStatus = "added" | "changed" | "removed" | "unchanged";

export interface OverlayResource {
  repoid: string;
  project: string;
  slug: string;
  folderPath: string;
  document: unknown;
}

/**
 * Compute the end result of a preview over the live state. For repoids the
 * preview covers (its registry rows), the preview's rows replace the live
 * rows wholesale — a live row with no preview counterpart is "removed", a
 * preview row with no live counterpart is "added". Live rows of uncovered
 * repoids pass through with no status: the preview says nothing about them.
 */
export function overlayPreview<T extends OverlayResource>(opts: {
  live: T[];
  previewRows: T[];
  coveredRepoids: ReadonlySet<string>;
}): (T & { previewStatus?: PreviewStatus })[] {
  // NUL-joined like reconcile's identity key: unambiguous even if a segment
  // ever contained the display separator.
  const key = (row: OverlayResource) =>
    `${row.repoid}\u0000${row.project}\u0000${row.slug}`;
  const liveByKey = new Map(opts.live.map((row) => [key(row), row]));
  const previewKeys = new Set(opts.previewRows.map(key));

  const out: (T & { previewStatus?: PreviewStatus })[] = [];
  for (const row of opts.previewRows) {
    const liveRow = liveByKey.get(key(row));
    if (!liveRow) {
      out.push({ ...row, previewStatus: "added" });
    } else if (
      liveRow.folderPath !== row.folderPath ||
      stableStringify(liveRow.document) !== stableStringify(row.document)
    ) {
      out.push({ ...row, previewStatus: "changed" });
    } else {
      out.push({ ...row, previewStatus: "unchanged" });
    }
  }
  for (const row of opts.live) {
    if (!opts.coveredRepoids.has(row.repoid)) {
      out.push(row);
    } else if (!previewKeys.has(key(row))) {
      out.push({ ...row, previewStatus: "removed" });
    }
    // Covered + present in the preview: already emitted above.
  }
  return out;
}
