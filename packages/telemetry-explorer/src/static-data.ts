// Owner of the shell's StaticDataRouteOption keys. Every program that mounts
// the shell imports this file through `./shell`, so it sees the keys. An app
// augments only keys the shell does not own: merged interface properties must
// have identical types, so a key is declared in one file only.
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
    showDataControls?: boolean;
    breadcrumb?:
      | string
      | ((
          match: AnyRouteMatch,
          context: BreadcrumbContext,
        ) => string | BreadcrumbSegment[] | undefined);
    hideTimeRangePicker?: boolean;
  }
}
