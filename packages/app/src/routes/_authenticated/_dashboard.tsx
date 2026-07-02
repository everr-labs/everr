import { resolve } from "@everr/datemath";
import { Separator } from "@everr/ui/components/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@everr/ui/components/sidebar";
import { cn } from "@everr/ui/lib/utils";
import {
  createFileRoute,
  Outlet,
  redirect,
  retainSearchParams,
  stripSearchParams,
  useMatches,
} from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { z } from "zod";
import { RefreshPicker } from "@/components/analytics/refresh-picker";
import { TimeRangePicker } from "@/components/analytics/time-range-picker";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandBar } from "@/components/command-bar";
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { PreviewIndicator } from "@/components/preview-indicator";
import { ExploreSearchRetainShape } from "@/lib/explore-search";
import {
  ResolvedTimeRangeSearchSchema,
  TimeRangeSearchSchema,
} from "@/lib/time-range";

const DashboardSearchSchema = TimeRangeSearchSchema.extend({
  // Explore section filters live at this level (not deeper on `_explore`) so the
  // sidebar links — rendered in this layout — retain them on click. See the
  // retainSearchParams note below.
  ...ExploreSearchRetainShape,
  github_install: z.string().optional(),
  reason: z.string().optional(),
  // Active preview (a preview/branch name). App-wide context: retained across
  // navigation (below) so the whole app stays in the same preview until the
  // user switches back to Live. Absent = Live.
  preview: z.string().optional(),
  // Dashboard variable values, e.g. ?vars={"env":"prod","svc":["a","b"]}.
  // Deliberately NOT retained across navigation — different dashboards have
  // different variables. Malformed values fall back to spec defaults.
  vars: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/_authenticated/_dashboard")({
  validateSearch: DashboardSearchSchema,
  search: {
    // `service`/`environment` are retained HERE (not on `_explore`) on purpose:
    // the sidebar links live in this `_dashboard` layout, outside the `_explore`
    // subtree, so only a retain declared at this level engages on a sidebar
    // click. Declaring it on `_explore` makes the link's href look right but
    // drops the params on the actual click. The explore route schemas include
    // these keys so the destination route doesn't strip them on arrival.
    //
    // strip-then-retain, paired with optional (default-less) explore schemas, is
    // what makes the filters both persistent AND clearable:
    //   - cross-route nav: the key arrives absent (no schema default fills it),
    //     so retain copies the live selection forward;
    //   - explicit clear (service: []): the value is present, so strip drops it
    //     as a default and retain — which only refills ABSENT keys — leaves it
    //     gone, yielding a clean URL that reflects the cleared state.
    // See ExploreSearchShape for why the schemas must stay optional.
    middlewares: [
      stripSearchParams({ service: [], environment: [] }),
      retainSearchParams([
        "from",
        "to",
        "refresh",
        "service",
        "environment",
        "preview",
      ]),
    ],
  },
  beforeLoad({ search }) {
    const { from, to } = ResolvedTimeRangeSearchSchema.parse(search);
    const fromDate = resolve(from, { roundUp: false });
    const toDate = resolve(to, { roundUp: true });
    if (fromDate >= toDate) {
      throw redirect({
        search: { ...search, from: to, to: from },
        replace: true,
      });
    }
  },
  head: () => ({
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
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();

  const matches = useMatches();
  let hideTimeRangePicker = false;
  let fullBleed = false;
  for (const match of matches) {
    if (match.staticData?.hideTimeRangePicker !== undefined) {
      hideTimeRangePicker = match.staticData.hideTimeRangePicker;
    }
    if (match.staticData?.fullBleed !== undefined) {
      fullBleed = match.staticData.fullBleed;
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-screen min-w-0">
        <header className="flex h-12 border-b border-sidebar-border px-3 bg-sidebar">
          <div className="flex items-center justify-between flex-1">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2" />
              <DashboardBreadcrumb />
            </div>
            <div className="flex items-center gap-1.5">
              <PreviewIndicator />
              <CommandBar />

              {!hideTimeRangePicker && (
                <>
                  <TimeRangePicker />
                  <RefreshPicker />
                </>
              )}
            </div>
          </div>
        </header>
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-auto",
            fullBleed ? "gap-0 p-0" : "gap-3 p-3",
          )}
        >
          {search.github_install === "linked" ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              GitHub installation linked successfully.
            </div>
          ) : null}
          {search.github_install === "error" ? (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              Failed to link GitHub installation
              {search.reason ? ` (${search.reason})` : ""}.
            </div>
          ) : null}
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
