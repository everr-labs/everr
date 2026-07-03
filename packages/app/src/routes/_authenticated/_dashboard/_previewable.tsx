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

export const Route = createFileRoute("/_authenticated/_dashboard/_previewable")(
  {
    component: PreviewableLayout,
  },
);

// Pathless layout for the "previewable" pages (dashboards, runbooks, alerts —
// list + detail). In preview mode the ui `PreviewFrame` frames the section and
// bars it (border + bar kept colour-synced by one variant); this layout just
// supplies the scrolling content, the copy, and the routing-backed exit action.
function PreviewableLayout() {
  const navigate = useNavigate();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  // Reads treat absent / "" / whitespace as live; mirror that so a stray
  // `?preview=` doesn't frame a live page.
  const name = (preview ?? "").trim();

  // Detail routes surface how *this* resource differs under the preview by
  // returning `previewStatus` from their loader; list routes don't. Walk the
  // matches root→leaf and keep the deepest one that carries a status, so the
  // bar tones its copy to the resource on screen (and falls back to generic copy
  // when none is present, e.g. the list pages or alert detail).
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

  // Live: no frame, no bar — just the scrolling content.
  if (!name) return content;

  return (
    <PreviewFrame
      variant="info"
      icon={<GitBranch className="size-4 shrink-0" />}
      message={previewMessage(name, status)}
      dismissible
      actions={
        // Exit is the labeled, primary affordance — a distinct `LogOut` glyph
        // (not an ×) so it never reads as a plain close.
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
