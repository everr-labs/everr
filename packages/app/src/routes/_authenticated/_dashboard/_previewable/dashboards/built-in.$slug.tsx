import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { CreateFromBuiltin } from "@/components/dashboards/create-from-builtin";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { DashboardNotFound } from "@/components/dashboards/dashboard-not-found";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import { evaluateBuiltin } from "@/data/dashboards/built-in/capabilities";
import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";
import { telemetryCapabilitiesOptions } from "@/data/dashboards/options";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";
import { useTimeRange } from "@/hooks/use-time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards/built-in/$slug",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Dashboards", to: "/dashboards" },
      { label: match.loaderData?.name ?? "Built-in dashboard" },
    ],
  },
  head: () => ({
    meta: [{ title: "Everr - Built-in dashboard" }],
    links: [
      { rel: "stylesheet", href: gridLayoutCSS },
      { rel: "stylesheet", href: gridLayoutOverridesCSS },
    ],
  }),
  component: BuiltinDashboardPage,
  notFoundComponent: DashboardNotFound,
  loader: ({ params: { slug } }) => {
    const builtin = getBuiltinDashboard(slug);
    if (!builtin) throw notFound();
    return {
      name: builtin.name,
      timeDefaults: dashboardTimeDefaults(builtin.document.spec),
    };
  },
});

/**
 * A Built-in dashboard is fully live and read-only: the real renderer on the
 * catalog document, never materialized per Organization. The only create
 * action is the assistant handoff (ADR 0004).
 */
function BuiltinDashboardPage() {
  const { slug } = Route.useParams();
  const builtin = getBuiltinDashboard(slug);
  const { timeRange } = useTimeRange();
  const capabilities = useQuery(
    telemetryCapabilitiesOptions(timeRange.from, timeRange.to),
  ).data;
  if (!builtin) return <DashboardNotFound />;

  const readiness = capabilities
    ? evaluateBuiltin(builtin, capabilities)
    : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-xl tracking-tight">
            {builtin.name}
          </h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            Built-in dashboard · {builtin.category}
          </p>
          <p className="mt-2 max-w-prose text-foreground/80 text-sm/relaxed">
            {builtin.description}
          </p>
          {readiness?.status === "needs-setup" && (
            <p role="status" className="mt-2 text-muted-foreground text-xs">
              Nothing to draw yet: this needs{" "}
              <span className="font-mono text-foreground/90">
                {readiness.missing.join(", ")}
              </span>{" "}
              in the selected time range.
            </p>
          )}
        </div>
        <div className="shrink-0">
          <CreateFromBuiltin slug={builtin.id} name={builtin.name} />
        </div>
      </header>

      <DashboardProvider document={builtin.document}>
        <DashboardGrid />
      </DashboardProvider>
    </div>
  );
}
