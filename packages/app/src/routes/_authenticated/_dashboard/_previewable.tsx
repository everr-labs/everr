import {
  createFileRoute,
  Outlet,
  useMatches,
  useSearch,
} from "@tanstack/react-router";
import { PreviewBanner } from "@/components/preview-banner";
import type { PreviewStatus } from "@/data/previews/overlay";

export const Route = createFileRoute("/_authenticated/_dashboard/_previewable")(
  {
    component: PreviewableLayout,
  },
);

// Pathless layout for the "previewable" pages (dashboards, runbooks, alerts —
// list + detail). It mounts ONE `<PreviewBanner>` for the whole subtree so the
// pill is a single persistent element that survives navigation between these
// routes (no per-page remount, no re-run entrance animation, no per-page prop
// threading). Being pathless, it adds no URL segment — the child URLs are
// unchanged.
//
// This is also the natural home for any subtree-wide chrome we may want later
// (e.g. a shared padding/max-width wrapper around previewable content): add it
// here rather than repeating it on every page.
function PreviewableLayout() {
  // App-wide preview context lives on the `_dashboard` ancestor; read it there.
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  // Detail routes surface how *this* resource differs under the preview by
  // returning `previewStatus` from their loader; list routes don't. Walk the
  // matches root→leaf and keep the deepest one that carries a status, so the
  // pill tones itself to the resource on screen (and falls back to generic copy
  // when none is present, e.g. the list pages or alert detail).
  const matches = useMatches();
  let status: PreviewStatus | undefined;
  for (const match of matches) {
    const data = match.loaderData as
      | { previewStatus?: PreviewStatus }
      | undefined;
    if (data?.previewStatus !== undefined) status = data.previewStatus;
  }

  // A fragment on purpose — NO wrapper div. The pill's sticky-lane math (see
  // preview-banner.tsx) depends on the banner and the page content both being
  // direct flex children of the `_dashboard` scroll column (`gap-3 p-3`); a
  // wrapper here would break the negative-margin cancellation and the float.
  return (
    <>
      <PreviewBanner preview={preview} status={status} />
      <Outlet />
    </>
  );
}
