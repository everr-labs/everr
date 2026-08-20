import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { DashboardNotFound } from "@/components/dashboards/dashboard-not-found";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import { lastViewedDashboard } from "@/data/dashboards/last-viewed";
import { dashboardOptions } from "@/data/dashboards/options";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards/$project/$slug",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Dashboards", to: "/dashboards" },
      { label: match.loaderData?.name ?? "Dashboard" },
    ],
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

  component: DashboardPage,
  notFoundComponent: DashboardNotFound,
  // Preview is app-wide search state; declaring it as a loader dep keeps the
  // prefetch keyed to the same (project, slug, preview) the component reads, so
  // switching previews refetches instead of serving the wrong overlay.
  loaderDeps: ({ search: { preview } }) => ({ preview }),
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
