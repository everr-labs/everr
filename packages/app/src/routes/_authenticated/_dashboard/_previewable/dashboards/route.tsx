import {
  createFileRoute,
  Outlet,
  retainSearchParams,
  useSearch,
} from "@tanstack/react-router";
import { DashboardsList } from "@/components/dashboards/dashboards-list";
import { RailFrame, railFrameRouteOptions } from "@/components/rail/rail-frame";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards",
)({
  ...railFrameRouteOptions,
  search: { middlewares: [retainSearchParams(["full"])] },
  component: DashboardsLayout,
});

/**
 * Dashboards in the shared rail frame. The in-page list is the only
 * enumeration of Dashboards; the app sidebar keeps a single flat link here.
 */
function DashboardsLayout() {
  const { full } = Route.useSearch();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });

  // Both directions of the toggle live inside the grid toolbar (`FrameToggle`
  // via DashboardGrid), so it costs no vertical space of its own.
  return (
    <RailFrame
      label="Dashboards"
      full={full ?? false}
      rail={<DashboardsList preview={preview} />}
      paneClassName="p-3"
    >
      <Outlet />
    </RailFrame>
  );
}
