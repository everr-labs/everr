import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { DashboardNotFound } from "@/components/dashboards/dashboard-not-found";
import { dashboardOptions } from "@/data/dashboards/options";
import { dashboardSearchDefaults } from "@/data/dashboards/time-defaults";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$source/$slug",
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
  loader: async ({ context: { queryClient }, params: { source, slug } }) => {
    try {
      const dashboard = await queryClient.ensureQueryData(
        dashboardOptions(source, slug),
      );
      return { name: dashboard.spec.display?.name ?? slug };
    } catch {
      throw notFound();
    }
  },
});

function DashboardPage() {
  const { source, slug } = Route.useParams();
  const key = `${source}/${slug}`;
  const { data } = useSuspenseQuery(dashboardOptions(source, slug));

  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const navigate = useNavigate();
  const seededFor = useRef<string | null>(null);
  // Seeds time-range defaults once per dashboard; reads search but intentionally does not re-run on search changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (seededFor.current === key) return;
    seededFor.current = key;
    const patch = dashboardSearchDefaults(data.spec, search);
    if (patch) {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
        replace: true,
      });
    }
  }, [key, data, navigate]);

  return <DashboardGrid />;
}
