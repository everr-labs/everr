import "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouteMatch } from "@tanstack/react-router";
import type { ReactElement } from "react";

export interface BreadcrumbSegment {
  label: string;
  link?: ReactElement;
  /** The real label is not known yet: mid-navigation the breadcrumb draws a
   *  skeleton instead; once settled (a missing resource) it shows this one. */
  unresolved?: boolean;
}

export interface BreadcrumbContext {
  /** For naming a page from cached data before its loader answers. */
  queryClient: QueryClient;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    authEntry?: "/auth/sign-up";
    showDataControls?: boolean;
    breadcrumb?:
      | string
      | ((
          match: AnyRouteMatch,
          context: BreadcrumbContext,
        ) => string | BreadcrumbSegment[] | undefined);
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
    /**
     * The page shows a `FrameToggle` for the rail frame it sits in, so on a
     * phone the rail can leave the layout and open as a sheet from it.
     */
    railToggle?: boolean;
  }
}
