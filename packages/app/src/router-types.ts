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
    /**
     * The route owns its scroll and touches the content edges (explorer-style
     * split panes): the `_previewable` layout skips PageContainer and its
     * page scroll for matches carrying this.
     */
    fullBleed?: boolean;
  }
}
