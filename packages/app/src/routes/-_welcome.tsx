import { layouts } from "@composition/layouts";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_welcome")({
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  return (
    <layouts.Welcome
      signedIn={!!session?.user}
      activeOrganizationId={session?.session.activeOrganizationId}
    >
      <Outlet />
    </layouts.Welcome>
  );
}
