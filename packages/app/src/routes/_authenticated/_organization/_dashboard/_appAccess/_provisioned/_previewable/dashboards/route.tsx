import {
  createFileRoute,
  Outlet,
  retainSearchParams,
  useMatches,
  useSearch,
} from "@tanstack/react-router";
import { DashboardsList } from "#app/components/dashboards/dashboards-list.tsx";
import { RailFrame, railFrameRouteOptions } from "#app/components/rail/rail-frame.tsx";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards",
)({
  ...railFrameRouteOptions,
  search: { middlewares: [retainSearchParams(["full"])] },
  component: DashboardsLayout,
});

const DASHBOARDS =
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards";

/** The pages that carry the dashboard toolbar, and so the toggle that brings the rail back. */
const TOOLBAR_PAGES = new Set<string>([
  `${DASHBOARDS}/$project/$slug/`,
  `${DASHBOARDS}/$project/$slug/panel/$panelKey`,
  `${DASHBOARDS}/built-in/$slug/`,
  `${DASHBOARDS}/built-in/$slug/panel/$panelKey`,
]);

/**
 * Dashboards in the shared rail frame. The in-page list is the only
 * enumeration of Dashboards; the app sidebar keeps a single flat link here.
 */
function DashboardsLayout() {
  const { full } = Route.useSearch();
  const { preview } = useSearch({
    from: "/_authenticated/_organization/_dashboard",
  });
  // On a phone the open dashboard gets the screen and the list hides behind
  // the toolbar's toggle. Pages without that toolbar (get started, not found,
  // errors) keep the list showing, or there would be no way back to it.
  const onToolbarPage = useMatches({
    select: (matches) => {
      const leaf = matches.at(-1);
      return leaf?.status === "success" && TOOLBAR_PAGES.has(leaf.routeId);
    },
  });

  // Both directions of the toggle live inside the grid toolbar (`FrameToggle`
  // via DashboardGrid), so it costs no vertical space of its own.
  return (
    <RailFrame
      label="Dashboards"
      full={full ?? false}
      rail={<DashboardsList preview={preview} />}
      collapsedOnNarrow={onToolbarPage}
      paneClassName="p-3"
    >
      <Outlet />
    </RailFrame>
  );
}
