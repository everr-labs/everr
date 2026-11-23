import { createFileRoute, Outlet } from "@tanstack/react-router";
import { exploreNavGroup } from "../../explore/routes";
import { AppShell } from "../../shell/app-shell";
import { shellRouteOptions } from "../../shell/route";

// Named before it is spread: router/create-route-property-order throws on a
// spread that is not an identifier (https://github.com/TanStack/router/issues/8673).
const shell = shellRouteOptions();

export const Route = createFileRoute("/_shell")({ ...shell, component: ContractShell });

function ContractShell() {
  return (
    <AppShell nav={[exploreNavGroup]} sidebarFooter={null}>
      <Outlet />
    </AppShell>
  );
}
