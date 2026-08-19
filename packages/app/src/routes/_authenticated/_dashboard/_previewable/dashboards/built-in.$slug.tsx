import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Info } from "lucide-react";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { CreateFromBuiltin } from "@/components/dashboards/create-from-builtin";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { DashboardNotFound } from "@/components/dashboards/dashboard-not-found";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import { evaluateBuiltin } from "@/data/dashboards/built-in/capabilities";
import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";
import { recordLastViewed } from "@/data/dashboards/last-viewed";
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
  loader: ({ context: { session }, params: { slug }, preload }) => {
    const builtin = getBuiltinDashboard(slug);
    if (!builtin) throw notFound();
    // Preloads (link hover) run this loader too; only a committed navigation
    // counts as "viewed".
    if (!preload)
      recordLastViewed(session.session.activeOrganizationId, {
        kind: "built-in",
        slug,
      });
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
  // The loader already 404s unknown slugs; this only narrows the type.
  if (!builtin) throw notFound();

  const readiness = capabilities
    ? evaluateBuiltin(builtin, capabilities)
    : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {readiness?.status === "needs-setup" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2"
        >
          <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Nothing to draw in this time range:{" "}
            <span className="font-mono text-foreground/90">
              {readiness.missing.join(", ")}
            </span>
            . The panels fill in on their own once that telemetry arrives. If
            you sent it before, widen the time range.
          </p>
        </div>
      )}

      {/* No header of its own: the list row and breadcrumb already name the
          built-in, so the page is the grid, and the fork action sits in the
          variable toolbar like any other dashboard control. */}
      <DashboardProvider document={builtin.document}>
        <DashboardGrid
          actions={<CreateFromBuiltin slug={builtin.id} name={builtin.name} />}
        />
      </DashboardProvider>
    </div>
  );
}
