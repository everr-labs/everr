import { Button } from "@everr/ui/components/button";
import { PreviewFrame } from "@everr/ui/components/preview-frame";
import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { GitBranch, LogOut } from "lucide-react";
import { PageContainer } from "@/components/page-container";
import { previewMessage } from "@/components/preview-message";
import type { PreviewStatus } from "@/data/previews/overlay";
import { usePreview } from "@/hooks/use-preview";
import { usePreviewDismissed } from "@/hooks/use-preview-dismissed";

export const Route = createFileRoute("/_authenticated/_dashboard/_previewable")(
  {
    component: PreviewableLayout,
  },
);

// Layout for the previewable pages (dashboards, runbooks, alerts). Supplies the
// scrolling content, copy, and exit action to the ui `PreviewFrame`.
function PreviewableLayout() {
  const { name, exit } = usePreview();
  const [dismissed, dismiss] = usePreviewDismissed(name);

  // Detail routes return `previewStatus` from their loader; list routes don't.
  // Keep the deepest status so the bar's copy matches the resource on screen.
  // Only trust matches under this layout, so an unrelated route that happens to
  // expose a `previewStatus` in its loaderData can't feed the bar.
  // A full-bleed route (explorer-style split panes) owns its scroll and
  // touches the content edges; every other route gets the padded page scroll.
  const matches = useMatches();
  let status: PreviewStatus | undefined;
  let hidePreviewFrame = false;
  let fullBleed = false;
  for (const match of matches) {
    if (!match.routeId.startsWith(Route.id)) continue;
    fullBleed ||= match.staticData.fullBleed ?? false;
    const data = match.loaderData as
      | { previewStatus?: PreviewStatus }
      | undefined;
    if (data?.previewStatus !== undefined) status = data.previewStatus;
    if (match.staticData?.hidePreviewFrame !== undefined) {
      hidePreviewFrame = match.staticData.hidePreviewFrame;
    }
  }

  const content = fullBleed ? (
    <div className="min-h-0 flex-1">
      <Outlet />
    </div>
  ) : (
    // `lg:flex lg:flex-col` (matching `ScrollPage`'s wrapper) is what lets
    // `PageContainer`'s own `flex-1 min-h-0` resolve to a real height here: a
    // block box doesn't hand a percentage/flex height down to its children, so
    // without this, PageContainer (and anything under it, like the alerting
    // section rail) has no definite height to fill and falls back to sizing
    // from its content. Scoped to `lg:` so mobile, which never asked for a
    // definite height here, is unaffected.
    <div className="min-h-0 flex-1 overflow-auto overscroll-y-contain lg:flex lg:flex-col">
      <PageContainer>
        <Outlet />
      </PageContainer>
    </div>
  );

  if (!name || hidePreviewFrame) return content;

  return (
    <PreviewFrame
      variant="info"
      icon={<GitBranch className="size-4 shrink-0" />}
      message={previewMessage(name, status)}
      dismissed={dismissed}
      onDismiss={dismiss}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={exit}
        >
          <LogOut data-icon="inline-start" />
          Exit preview
        </Button>
      }
    >
      {content}
    </PreviewFrame>
  );
}
