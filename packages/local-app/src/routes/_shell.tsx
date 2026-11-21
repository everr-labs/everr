import { exploreNavGroup } from "@everr/app-shell/explore/routes";
import { AppShell, shellRouteOptions } from "@everr/app-shell/shell";
import type { QueryFilters } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LocalSidebarFooter } from "../features/app-shell/sidebar-footer";

// Named before it is spread: router/create-route-property-order throws on a
// spread that is not an identifier (https://github.com/TanStack/router/issues/8673).
const shell = shellRouteOptions();

// Every query on the page, but not the app's own, such as the collector status
// it polls by itself. A constant: a new object would restart the auto-refresh
// timer on each render.
const refreshScope = {
  type: "active",
  predicate: ({ queryKey }) => queryKey[0] !== "local-app",
} satisfies QueryFilters;

export const Route = createFileRoute("/_shell")({ ...shell, component: LocalShell });

function LocalShell() {
  return (
    <AppShell
      nav={[exploreNavGroup]}
      sidebarFooter={<LocalSidebarFooter />}
      refreshScope={refreshScope}
    >
      <Outlet />
    </AppShell>
  );
}
