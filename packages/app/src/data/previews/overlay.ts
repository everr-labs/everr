import { z } from "zod";
import { stableStringify } from "@/data/as-code/reconcile";

export const PreviewStatusSchema = z.enum([
  "added",
  "changed",
  "conflict",
  "removed",
  "unchanged",
]);

export type PreviewStatus = z.infer<typeof PreviewStatusSchema>;

export interface OverlayResource {
  repoid: string;
  // null marks a live row; a registry id marks a preview row (see `overlayPreview`).
  previewId: string | null;
}

// End state of a preview over live: for covered repoids the preview's rows
// replace the live ones (missing preview row = "removed", missing live row =
// "added"); live rows of uncovered repoids pass through untagged; preview rows
// outside the covered set are orphans and dropped. A preview add whose global
// identity is already a live resource owned by a different repo is a
// "conflict": merging it would fail the cross-repo ownership check.
//
// `identity` and `content` are the caller's, because each resource stores those
// two differently: a dashboard's content is its document plus the folder it
// sits in, an alert rule's is its spec plus the channels it notifies.
export function overlayPreview<T extends OverlayResource>(opts: {
  rows: T[];
  coveredRepoids: ReadonlySet<string>;
  /** The resource's owner-agnostic global identity within the organization. */
  identity: (row: T) => string;
  /** Everything a branch can declare about the resource. Rows whose content
   *  stringifies the same are the same resource, so the preview changed it not
   *  at all. */
  content: (row: T) => unknown;
}): (T & { previewStatus?: PreviewStatus })[] {
  // null = live, a registry id = a preview row.
  const live = opts.rows.filter((row) => row.previewId === null);
  const previewRows = opts.rows.filter((row) => row.previewId !== null);

  // JSON-encoded pair, not a joined string: no separator to collide with
  // whatever characters a repoid or an identity carries.
  const key = (row: T) => JSON.stringify([row.repoid, opts.identity(row)]);
  // Owner-agnostic identity: a live match under a *different* owner is a
  // cross-repo clash, not an edit.
  const liveByKey = new Map(live.map((row) => [key(row), row]));
  const liveByIdentity = new Map(live.map((row) => [opts.identity(row), row]));
  const previewKeys = new Set(previewRows.map(key));

  const out: (T & { previewStatus?: PreviewStatus })[] = [];
  for (const row of previewRows) {
    // Orphan preview row (repoid the registry doesn't cover), so skip it.
    if (!opts.coveredRepoids.has(row.repoid)) continue;
    const liveRow = liveByKey.get(key(row));
    if (!liveRow) {
      // No same-owner live row. A live resource with this identity under a
      // different owner (same-owner would have matched above) means a merge
      // would collide → conflict; otherwise it's a genuine add.
      const status: PreviewStatus = liveByIdentity.has(opts.identity(row))
        ? "conflict"
        : "added";
      out.push({ ...row, previewStatus: status });
    } else if (
      stableStringify(opts.content(liveRow)) !==
      stableStringify(opts.content(row))
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
