import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { DashboardNotFound } from "@/components/dashboards/dashboard-not-found";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import { dashboardOptions } from "@/data/dashboards/options";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$project/$slug",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Dashboards", to: "/dashboards" },
      { label: match.loaderData?.name ?? "Dashboard" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Dashboard" }] }),
  component: DashboardPage,
  notFoundComponent: DashboardNotFound,
  loader: async ({ context: { queryClient }, params: { project, slug } }) => {
    // A missing dashboard throws notFound() from the server fn (→ notFound UI);
    // any other failure propagates to the error boundary instead of being
    // masked as not-found.
    const { document } = await queryClient.ensureQueryData(
      dashboardOptions(project, slug),
    );
    // Expose the dashboard's duration/refreshInterval as route time defaults so
    // the time-range hooks seed the picker and panels from the first render —
    // no post-mount URL write, so panels never query the wrong window first.
    return {
      name: document.spec.display?.name ?? slug,
      timeDefaults: dashboardTimeDefaults(document.spec),
    };
  },
});

function DashboardPage() {
  const { project, slug } = Route.useParams();
  // The dashboard is immutable (gitops, read-only), so the query cache is the
  // single source of truth; the loader has already ensured the data.
  const {
    data: { document },
  } = useSuspenseQuery(dashboardOptions(project, slug));
  return (
    <DashboardProvider document={document}>
      <DashboardGrid />
    </DashboardProvider>
  );
}
