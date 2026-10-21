import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import gridLayoutOverridesCSS from "#app/components/dashboards/dashboard-grid.css?url";
import { DashboardGrid } from "#app/components/dashboards/dashboard-grid.tsx";
import { DashboardNotFound } from "#app/components/dashboards/dashboard-not-found.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import { lastViewedDashboard } from "#app/data/dashboards/last-viewed.ts";
import { dashboardOptions } from "#app/data/dashboards/options.ts";
import { dashboardTimeDefaults } from "#app/data/dashboards/time-defaults.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/$project/$slug",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Dashboards", link: <Link to="/dashboards" /> },
      { label: match.loaderData?.name ?? "Dashboard" },
    ],
  },
  loaderDeps: ({ search: { preview } }) => ({ preview }),

  component: DashboardPage,
  notFoundComponent: DashboardNotFound,
  // Preview is app-wide search state; declaring it as a loader dep keeps the
  // prefetch keyed to the same (project, slug, preview) the component reads, so
  // switching previews refetches instead of serving the wrong overlay.
  loader: async ({
    context: { queryClient, session },
    params: { project, slug },
    deps: { preview },
    preload,
  }) => {
    // A missing dashboard throws notFound() from the server fn (→ notFound UI);
    // any other failure propagates to the error boundary instead of being
    // masked as not-found.
    const { document, previewStatus } = await queryClient.ensureQueryData(
      dashboardOptions(project, slug, preview),
    );
    // Preloads (link hover) run this loader too; only a committed navigation
    // counts as "viewed".
    if (!preload)
      lastViewedDashboard.record(session.session.activeOrganizationId, {
        kind: "own",
        project,
        slug,
      });
    // Expose the dashboard's duration/refreshInterval as route time defaults so
    // the time-range hooks seed the picker and panels from the first render —
    // no post-mount URL write, so panels never query the wrong window first.
    // `previewStatus` rides the loaderData up to the `_previewable` layout, which
    // reads the deepest match carrying it to tone the shared preview pill.
    return {
      name: document.spec.display?.name ?? slug,
      previewStatus,
      timeDefaults: dashboardTimeDefaults(document.spec),
    };
  },
  head: () => ({
    meta: [{ title: "Everr - Dashboard" }],
    links: [
      {
        rel: "stylesheet",
        href: gridLayoutCSS,
      },
      {
        rel: "stylesheet",
        href: gridLayoutOverridesCSS,
      },
    ],
  }),
});

function DashboardPage() {
  const { project, slug } = Route.useParams();
  const { preview } = Route.useSearch();
  // The dashboard is immutable (gitops, read-only), so the query cache is the
  // single source of truth; the loader has already ensured the data.
  const {
    data: { document },
  } = useSuspenseQuery(dashboardOptions(project, slug, preview));
  return (
    <DashboardProvider document={document}>
      <DashboardGrid />
    </DashboardProvider>
  );
}
