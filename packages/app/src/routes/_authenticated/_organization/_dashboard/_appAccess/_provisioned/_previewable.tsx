import { Button } from "@everr/ui/components/button";
import { PreviewFrame } from "@everr/ui/components/preview-frame";
import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { GitBranch, LogOut } from "lucide-react";
import { ScrollingPageContainer } from "#app/components/page-container.tsx";
import { previewMessage } from "#app/components/preview-message.ts";
import type { PreviewStatus } from "#app/data/previews/overlay.ts";
import { usePreview } from "#app/hooks/use-preview.ts";
import { usePreviewDismissed } from "#app/hooks/use-preview-dismissed.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable",
)({
  component: PreviewableLayout,
});

function isPreviewStatus(value: unknown): value is PreviewStatus {
  return (
    value === "added" ||
    value === "changed" ||
    value === "conflict" ||
    value === "removed" ||
    value === "unchanged"
  );
}

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
    const data = match.loaderData;
    if (
      data &&
      typeof data === "object" &&
      "previewStatus" in data &&
      isPreviewStatus(data.previewStatus)
    )
      status = data.previewStatus;
    if (match.staticData?.hidePreviewFrame !== undefined) {
      hidePreviewFrame = match.staticData.hidePreviewFrame;
    }
  }

  const content = fullBleed ? (
    <div className="min-h-0 flex-1">
      <Outlet />
    </div>
  ) : (
    <ScrollingPageContainer>
      <Outlet />
    </ScrollingPageContainer>
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
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={exit}>
          <LogOut data-icon="inline-start" />
          Exit preview
        </Button>
      }
    >
      {content}
    </PreviewFrame>
  );
}
