import type { QueryClient } from "@tanstack/react-query";
import { Link, notFound } from "@tanstack/react-router";
import {
  type DashboardViewSearch,
  pickDashboardViewSearch,
} from "#app/components/dashboards/dashboard-panel.tsx";
import { lastViewedDashboard } from "#app/data/dashboards/last-viewed.ts";
import { dashboardOptions } from "#app/data/dashboards/options.ts";
import type { Dashboard } from "#app/data/dashboards/schema.ts";
import { dashboardTimeDefaults } from "#app/data/dashboards/time-defaults.ts";
import type { BreadcrumbSegment } from "#app/router-types.ts";

/**
 * Shared route config for the dashboard index and panel routes (mirrors
 * `-runbook-route.tsx`): the two pages differ only in their component, so the
 * breadcrumb, head, and loader live here once instead of drifting between them.
 */

export const dashboardBreadcrumb = (match: {
  params: { project?: string; slug: string };
  search: DashboardViewSearch;
  loaderData?: { name: string; panelName?: string };
}): BreadcrumbSegment[] => {
  const { project, slug } = match.params;
  // Built-in routes have no `$project` param; own ones always do.
  const name =
    match.loaderData?.name ?? (project === undefined ? "Built-in dashboard" : "Dashboard");
  const panelName = match.loaderData?.panelName;
  const dashboards = { label: "Dashboards", link: <Link to="/dashboards" /> };
  // On the index the dashboard is where you are; on its panel page it becomes
  // the way back, and the panel names the place.
  if (panelName === undefined) return [dashboards, { label: name }];
  // The way back carries the same view state the maximize link brought here:
  // `vars` is not retained across navigation, so without it the dashboard's
  // variables reset.
  const search = pickDashboardViewSearch(match.search);
  return [
    dashboards,
    {
      label: name,
      link:
        project === undefined ? (
          <Link to="/dashboards/built-in/$slug" params={{ slug }} search={search} />
        ) : (
          <Link to="/dashboards/$project/$slug" params={{ project, slug }} search={search} />
        ),
    },
    { label: panelName },
  ];
};

export const dashboardHead = () => ({
  meta: [{ title: "Everr - Dashboard" }],
});

export async function loadDashboard({
  queryClient,
  session,
  project,
  slug,
  preview,
  preload,
  panelKey,
}: {
  queryClient: QueryClient;
  session: { session: { activeOrganizationId: string } };
  project: string;
  slug: string;
  preview?: string;
  preload: boolean;
  /** The panel being opened full-screen, to 404 unknown keys. */
  panelKey?: string;
}) {
  // A missing dashboard throws notFound() from the server fn (→ notFound UI);
  // any other failure propagates to the error boundary instead of being
  // masked as not-found.
  const { document, previewStatus } = await queryClient.ensureQueryData(
    dashboardOptions(project, slug, preview),
  );
  // An unknown panel key 404s here, before the visit is recorded as viewed:
  // the panel page has no fallback of its own, so the route's
  // notFoundComponent answers.
  const panelName = panelKey ? panelDisplayName(document, panelKey) : undefined;
  // Preloads (link hover) run this loader too; only a committed navigation
  // counts as "viewed".
  if (!preload)
    lastViewedDashboard.record(session.session.activeOrganizationId, {
      kind: "own",
      project,
      slug,
    });
  return {
    name: document.spec.display?.name ?? slug,
    panelName,
    previewStatus,
    // Expose the dashboard's duration/refreshInterval as route time defaults so
    // the time-range hooks seed the picker and panels from the first render —
    // no post-mount URL write, so panels never query the wrong window first.
    // `previewStatus` rides the loaderData up to the `_previewable` layout,
    // which reads the deepest match carrying it to tone the shared preview pill.
    timeDefaults: dashboardTimeDefaults(document.spec),
  };
}

/** The header title of a panel, 404 when the dashboard has no such panel. */
function panelDisplayName(document: Dashboard, panelKey: string) {
  const panel = document.spec.panels[panelKey];
  if (!panel) throw notFound();
  return panel.spec.display?.name ?? panelKey;
}
