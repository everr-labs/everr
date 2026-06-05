import { resolve } from "@everr/datemath";
import { Separator } from "@everr/ui/components/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@everr/ui/components/sidebar";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
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
import {
  ResolvedTimeRangeSearchSchema,
  TimeRangeSearchSchema,
} from "@/lib/time-range";

const DashboardSearchSchema = TimeRangeSearchSchema.extend({
  github_install: z.string().optional(),
  reason: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/_dashboard")({
  validateSearch: DashboardSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({
        from: DEFAULT_TIME_RANGE.from,
        to: DEFAULT_TIME_RANGE.to,
        refresh: "",
      }),
      retainSearchParams(["from", "to", "refresh"]),
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
      <AppSidebar style={{ viewTransitionName: "sidebar" }} />
      <SidebarInset className="h-screen min-w-0">
        <header
          className="flex h-12 border-b border-sidebar-border px-3 bg-sidebar"
          style={{ viewTransitionName: "topnav" }}
        >
          <div className="flex items-center justify-between flex-1">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2" />
              <DashboardBreadcrumb />
            </div>
            <div className="flex items-center gap-1.5">
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
