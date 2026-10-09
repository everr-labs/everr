import { Separator } from "@everr/ui/components/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@everr/ui/components/sidebar";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Outlet,
  useMatches,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router";
import { homeView } from "@/common/onboarding";
import { RefreshPicker } from "@/components/analytics/refresh-picker";
import { TimeRangePicker } from "@/components/analytics/time-range-picker";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandBar } from "@/components/command-bar";
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb";
import { PreviewIndicator } from "@/components/preview-indicator";
import { homeStatusQueryOptions } from "@/data/onboarding/options";
import { SIDEBAR_TRACKED_LEFT } from "@/lib/sidebar-tracked-left";

export function DashboardLayout() {
  const { session } = useRouteContext({ from: "/_authenticated" });
  const search = useSearch({ strict: false });

  const matches = useMatches();
  const homeMatch = matches.find(
    (match) =>
      match.routeId ===
      "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/",
  );
  const homeStatus = useQuery({
    ...homeStatusQueryOptions(
      session.user.id,
      session.session.activeOrganizationId ?? "",
    ),
    enabled: Boolean(homeMatch && session.session.activeOrganizationId),
    // Home owns the poll; the layout only observes its cached view decision.
    refetchInterval: false,
  });
  const showDataControls = matches.some(
    (match) => match.staticData.showDataControls,
  );
  let hideTimeRangePicker = false;
  for (const match of matches) {
    if (match.staticData?.hideTimeRangePicker !== undefined) {
      hideTimeRangePicker = match.staticData.hideTimeRangePicker;
    }
  }

  if (homeMatch) {
    const setupRequested =
      "setup" in homeMatch.search && homeMatch.search.setup === 1;
    hideTimeRangePicker =
      !homeStatus.data ||
      homeView(homeStatus.data, setupRequested) !== "dashboard";
  }

  if (!session.session.activeOrganizationId) {
    return <Outlet />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-screen min-w-0 pt-12">
        {/* `fixed` (not sticky): the macOS rubber-band translates in-flow
            content but leaves fixed elements pinned, so the topnav stays put.
            SidebarInset compensates with pt-12. */}
        <header
          className={cn(
            "fixed top-0 right-0 z-50 flex h-12 border-b border-sidebar-border bg-sidebar px-3",
            SIDEBAR_TRACKED_LEFT,
          )}
        >
          <div className="flex items-center justify-between flex-1">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1 size-11 md:size-8" />
              <Separator orientation="vertical" className="mr-2" />
              <DashboardBreadcrumb />
            </div>
            <div className="flex items-center gap-1.5">
              {showDataControls && <PreviewIndicator />}
              {showDataControls && <CommandBar />}

              {showDataControls && !hideTimeRangePicker && (
                <>
                  <TimeRangePicker />
                  <RefreshPicker />
                </>
              )}
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {search.github_install === "linked" && (
            <div className="mx-3 mt-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              GitHub installation linked successfully.
            </div>
          )}

          {search.github_install === "error" && (
            <div className="mx-3 mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              Failed to link GitHub installation
              {search.reason ? ` (${search.reason})` : ""}.
            </div>
          )}
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
