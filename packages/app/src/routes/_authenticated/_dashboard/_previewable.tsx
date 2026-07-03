import { Button } from "@everr/ui/components/button";
import { PreviewFrame } from "@everr/ui/components/preview-frame";
import {
  createFileRoute,
  Outlet,
  useMatches,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { GitBranch, LogOut } from "lucide-react";
import { PageContainer } from "@/components/page-container";
import { previewMessage } from "@/components/preview-message";
import type { PreviewStatus } from "@/data/previews/overlay";
import { usePreviewDismissed } from "@/hooks/use-preview-dismissed";

export const Route = createFileRoute("/_authenticated/_dashboard/_previewable")(
  {
    component: PreviewableLayout,
  },
);

// Layout for the previewable pages (dashboards, runbooks, alerts). Supplies the
// scrolling content, copy, and exit action to the ui `PreviewFrame`.
function PreviewableLayout() {
  const navigate = useNavigate();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  // "" / whitespace is live.
  const name = (preview ?? "").trim();
  const [dismissed, dismiss] = usePreviewDismissed(name);

  // Detail routes return `previewStatus` from their loader; list routes don't.
  // Keep the deepest status so the bar's copy matches the resource on screen.
  const matches = useMatches();
  let status: PreviewStatus | undefined;
  for (const match of matches) {
    const data = match.loaderData as
      | { previewStatus?: PreviewStatus }
      | undefined;
    if (data?.previewStatus !== undefined) status = data.previewStatus;
  }

  const content = (
    <div className="min-h-0 flex-1 overflow-auto overscroll-y-contain">
      <PageContainer>
        <Outlet />
      </PageContainer>
    </div>
  );

  if (!name) return content;

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
          onClick={() =>
            navigate({
              to: ".",
              search: (prev) => ({ ...prev, preview: undefined }),
            })
          }
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
