import "@tanstack/react-router";
import type { AnyRouteMatch } from "@tanstack/react-router";

export interface BreadcrumbSegment {
  label: string;
  search: Record<string, unknown>;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    breadcrumb?:
      | string
      | ((match: AnyRouteMatch) => string | BreadcrumbSegment[] | undefined);
    hideTimeRangePicker?: boolean;
  }
}
