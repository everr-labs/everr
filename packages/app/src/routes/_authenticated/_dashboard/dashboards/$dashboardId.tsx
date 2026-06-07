import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions } from "@/data/dashboards/options";
import { dashboardSearchDefaults } from "@/data/dashboards/time-defaults";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Dashboards", to: "/dashboards" },
      { label: match.loaderData?.name ?? "Dashboard" },
    ],
  },
  head: () => ({
    meta: [{ title: "Everr - Dashboard" }],
  }),
  component: DashboardPage,
  notFoundComponent: DashboardNotFound,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    try {
      const dashboard = await queryClient.ensureQueryData(
        dashboardOptions(dashboardId),
      );
      return { name: dashboard.spec.display?.name ?? dashboardId };
    } catch {
      throw notFound();
    }
  },
});

function DashboardNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <p className="text-lg">Dashboard not found</p>
      <Link to="/dashboards" className="text-sm underline">
        Back to dashboards
      </Link>
    </div>
  );
}

function DashboardPage() {
  const { dashboardId } = Route.useParams();
  const { data } = useSuspenseQuery(dashboardOptions(dashboardId));
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const dashboard = useDashboardStore((s) => s.dashboard);
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);

  useEffect(() => {
    // Compare row identity (sourceSlug), not metadata.name: a staged slug
    // rename makes the names diverge, and replacing the store here would
    // silently discard every dirty change.
    if (!dashboard || sourceSlug !== dashboardId) {
      setDashboard(data);
    }
  }, [data, dashboard, sourceSlug, dashboardId, setDashboard]);

  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const navigate = useNavigate();
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (seededFor.current === dashboardId) return;
    seededFor.current = dashboardId;
    const patch = dashboardSearchDefaults(data.spec, search);
    if (patch) {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
        replace: true,
      });
    }
  }, [dashboardId, data, search, navigate]);

  if (!dashboard) return null;

  return <DashboardGrid />;
}
