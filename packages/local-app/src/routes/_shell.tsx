import { exploreNavGroup } from "@everr/telemetry-explorer/explore/routes";
import { AppShell, shellRouteOptions } from "@everr/telemetry-explorer/shell";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LocalSidebarFooter } from "../features/app-shell/sidebar-footer";

// Named before it is spread: router/create-route-property-order throws on a
// spread that is not an identifier (https://github.com/TanStack/router/issues/8673).
const shell = shellRouteOptions();

export const Route = createFileRoute("/_shell")({ ...shell, component: LocalShell });

function LocalShell() {
  return (
    <AppShell nav={[exploreNavGroup]} sidebarFooter={<LocalSidebarFooter />}>
      <Outlet />
    </AppShell>
  );
}
