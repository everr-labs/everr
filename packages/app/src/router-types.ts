import "@tanstack/react-router";
import type { AnyRouteMatch } from "@tanstack/react-router";

export interface BreadcrumbSegment {
  label: string;
  to?: string;
  search?: Record<string, unknown>;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    breadcrumb?:
      | string
      | ((match: AnyRouteMatch) => string | BreadcrumbSegment[] | undefined);
    hideTimeRangePicker?: boolean;
    hideExploreBar?: boolean;
    // Suppresses the `PreviewFrame` banner in `_previewable.tsx`. Set on pages
    // that show live/operational state rather than an as-code resource a
    // preview branch could change, so the banner doesn't imply a preview
    // overlay that isn't actually there.
    hidePreviewFrame?: boolean;
    /**
     * The route owns its scroll and touches the content edges (explorer-style
     * split panes): the `_previewable` layout skips PageContainer and its
     * page scroll for matches carrying this.
     */
    fullBleed?: boolean;
  }
}
