import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DashboardSettingsPage } from "@/components/dashboards/dashboard-settings-page";
import { dashboardOptions } from "@/data/dashboards/options";

// Merged with the _dashboard layout's schema by TanStack Router — this route
// only declares `section`; from/to/vars keep coming from the layout.
const SettingsSearchSchema = z.object({
  section: z.enum(["general", "variables"]).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId_/settings",
)({
  validateSearch: SettingsSearchSchema,
  staticData: { breadcrumb: "Settings" },
  head: () => ({
    meta: [{ title: "Everr - Dashboard Settings" }],
  }),
  component: DashboardSettingsRoute,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    if (dashboardId !== "new") {
      await queryClient.prefetchQuery(dashboardOptions(dashboardId));
    }
  },
});

function DashboardSettingsRoute() {
  const { dashboardId } = Route.useParams();
  const { section } = Route.useSearch();
  return (
    <DashboardSettingsPage dashboardId={dashboardId} initialSection={section} />
  );
}
