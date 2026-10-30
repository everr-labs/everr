import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import gridLayoutOverridesCSS from "#app/components/dashboards/dashboard-grid.css?url";
import { DashboardGrid } from "#app/components/dashboards/dashboard-grid.tsx";
import { DashboardNotFound } from "#app/components/dashboards/dashboard-not-found.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import { dashboardOptions } from "#app/data/dashboards/options.ts";
import { dashboardBreadcrumb, dashboardHead, loadDashboard } from "./-dashboard-route";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/$project/$slug/",
)({
  staticData: { breadcrumb: dashboardBreadcrumb },
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
  }) =>
    loadDashboard({
      queryClient,
      session,
      project,
      slug,
      preview,
      preload,
    }),
  head: () => ({
    ...dashboardHead(),
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
      <DashboardGrid panelFullscreenTo={{ kind: "dashboard", project, slug }} />
    </DashboardProvider>
  );
}
