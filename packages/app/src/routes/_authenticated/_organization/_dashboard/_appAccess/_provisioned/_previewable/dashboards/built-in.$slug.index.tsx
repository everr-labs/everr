/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Composite charts, live regions, and custom controls require their ARIA roles on the existing elements. */
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Info } from "lucide-react";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { CreateFromBuiltin } from "#app/components/dashboards/create-from-builtin.tsx";
import gridLayoutOverridesCSS from "#app/components/dashboards/dashboard-grid.css?url";
import { DashboardGrid } from "#app/components/dashboards/dashboard-grid.tsx";
import { DashboardNotFound } from "#app/components/dashboards/dashboard-not-found.tsx";
import { InstrumentFromBuiltin } from "#app/components/dashboards/instrument-from-builtin.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import { evaluateBuiltin } from "#app/data/dashboards/built-in/capabilities.ts";
import { getBuiltinDashboard } from "#app/data/dashboards/built-in/catalog/index.ts";
import { lastViewedDashboard } from "#app/data/dashboards/last-viewed.ts";
import { telemetryCapabilitiesOptions } from "#app/data/dashboards/options.ts";
import { dashboardTimeDefaults } from "#app/data/dashboards/time-defaults.ts";
import { dashboardBreadcrumb } from "./-dashboard-route";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/built-in/$slug/",
)({
  staticData: { breadcrumb: dashboardBreadcrumb },
  loader: ({ context: { session }, params: { slug }, preload }) => {
    const builtin = getBuiltinDashboard(slug);
    if (!builtin) throw notFound();
    // Preloads (link hover) run this loader too; only a committed navigation
    // counts as "viewed".
    if (!preload)
      lastViewedDashboard.record(session.session.activeOrganizationId, {
        kind: "built-in",
        slug,
      });
    return {
      name: builtin.name,
      timeDefaults: dashboardTimeDefaults(builtin.document.spec),
    };
  },
  component: BuiltinDashboardPage,
  notFoundComponent: DashboardNotFound,
  head: () => ({
    meta: [{ title: "Everr - Built-in dashboard" }],
    links: [
      { rel: "stylesheet", href: gridLayoutCSS },
      { rel: "stylesheet", href: gridLayoutOverridesCSS },
    ],
  }),
});

/**
 * A Built-in dashboard is fully live and read-only: the real renderer on the
 * catalog document, never materialized per Organization. The only create
 * action is the assistant handoff (ADR 0004).
 */
function BuiltinDashboardPage() {
  const { slug } = Route.useParams();
  const builtin = getBuiltinDashboard(slug);
  // Same fixed-window probe as the rail's ready/needs-data grouping (and the
  // same query cache entry), so this page can never call a dashboard unready
  // while the list files it under ready, or the other way around. The
  // on-screen range only affects what the panels draw.
  const capabilities = useQuery(
    telemetryCapabilitiesOptions(DEFAULT_TIME_RANGE.from, DEFAULT_TIME_RANGE.to),
  ).data;
  // The loader already 404s unknown slugs; this only narrows the type.
  if (!builtin) throw notFound();

  const readiness = capabilities ? evaluateBuiltin(builtin, capabilities) : null;
  const needsSetup = readiness?.status === "needs-setup" ? readiness : null;

  const notice = needsSetup && (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2"
    >
      <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground text-xs leading-relaxed">
        Nothing sent in the last 7 days:{" "}
        <span className="font-mono text-foreground/90">{needsSetup.missing.join(", ")}</span>. The
        panels fill in on their own once that telemetry arrives.
      </p>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* No header of its own: the list row and breadcrumb already name the
          built-in, so the page is the grid, and the action sits in the
          variable toolbar like any other dashboard control. Fork when ready,
          instrumentation prompt when data is missing. */}
      <DashboardProvider document={builtin.document}>
        <DashboardGrid
          notice={notice}
          panelFullscreenTo={{ kind: "builtin", slug }}
          actions={
            needsSetup ? (
              <InstrumentFromBuiltin name={builtin.name} missing={needsSetup.missing} />
            ) : (
              <CreateFromBuiltin slug={builtin.id} name={builtin.name} />
            )
          }
        />
      </DashboardProvider>
    </div>
  );
}
