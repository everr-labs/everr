/* oxlint-disable typescript/no-base-to-string -- Preserve how existing URL search values are displayed, including JavaScript coercion. */
/* oxlint-disable typescript/restrict-template-expressions -- Preserve how existing URL search values are displayed, including JavaScript coercion. */
import { Separator } from "@everr/ui/components/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@everr/ui/components/sidebar";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useMatches, useRouteContext, useSearch } from "@tanstack/react-router";
import { homeView } from "#app/common/onboarding.ts";
import { RefreshPicker } from "#app/components/analytics/refresh-picker.tsx";
import { TimeRangePicker } from "#app/components/analytics/time-range-picker.tsx";
import { AppSidebar } from "#app/components/app-sidebar.tsx";
import { CommandBar } from "#app/components/command-bar.tsx";
import { DashboardBreadcrumb } from "#app/components/dashboard-breadcrumb.tsx";
import { PreviewIndicator } from "#app/components/preview-indicator.tsx";
import { homeStatusQueryOptions } from "#app/data/onboarding/options.ts";
import { TimeAnchorProvider } from "#app/hooks/time-anchor.tsx";
import { SIDEBAR_TRACKED_LEFT } from "#app/lib/sidebar-tracked-left.ts";

export function DashboardLayout() {
  const { session } = useRouteContext({ from: "/_authenticated" });
  const search = useSearch({ strict: false });

  // Only what the shell reads, structurally shared: the router updates its
  // matches at every step of a navigation, and re-rendering the whole shell on
  // each one was most of a navigation's cost.
  const matches = useMatches({
    select: (all) =>
      all.map((match) => ({
        routeId: match.routeId,
        setupRequested: "setup" in match.search && match.search.setup === 1,
        showDataControls: match.staticData.showDataControls,
        hideTimeRangePicker: match.staticData.hideTimeRangePicker,
      })),
    structuralSharing: true,
  });
  const homeMatch = matches.find(
    (match) =>
      match.routeId === "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/",
  );
  const homeStatus = useQuery({
    ...homeStatusQueryOptions(session.user.id, session.session.activeOrganizationId ?? ""),
    enabled: Boolean(homeMatch && session.session.activeOrganizationId),
    // Home owns the poll; the layout only observes its cached view decision.
    refetchInterval: false,
  });
  const showDataControls = matches.some((match) => match.showDataControls);
  // The account pages share this shell but not the organization's time range.
  const hasTimeRange = matches.some(
    (match) => match.routeId === "/_authenticated/_organization/_dashboard",
  );
  let hideTimeRangePicker = false;
  for (const match of matches) {
    if (match.hideTimeRangePicker !== undefined) {
      hideTimeRangePicker = match.hideTimeRangePicker;
    }
  }

  if (homeMatch) {
    hideTimeRangePicker = homeView(homeStatus.data, homeMatch.setupRequested) !== "dashboard";
  }

  if (!session.session.activeOrganizationId) {
    return <Outlet />;
  }

  return (
    // The shell is pinned to the viewport (`fixed inset-0`) instead of sized
    // with a viewport unit: mobile browsers disagree on what `100vh`/`100dvh`
    // cover next to their own toolbars (DuckDuckGo on iOS leaves the page
    // scrollable past its end), while a fixed box always matches the area the
    // browser actually shows. Every pane scrolls on its own; the document never does.
    <SidebarProvider className="bg-sidebar fixed inset-0 min-h-0">
      {/* The sidebar and the topnav are one frame in the shell colour; the page
          sits inside it as a lighter panel, so the content reads as the top
          layer. */}
      <AppSidebar className="group-data-[side=left]:border-r-0" />
      <SidebarInset className="bg-sidebar min-h-0 min-w-0 pt-12">
        {/* `fixed` (not sticky): the macOS rubber-band translates in-flow
            content but leaves fixed elements pinned, so the topnav stays put.
            SidebarInset compensates with pt-12. */}
        <header
          data-app-header
          className={cn("fixed top-0 right-0 z-50 flex h-12 bg-sidebar px-3", SIDEBAR_TRACKED_LEFT)}
        >
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            {/* The breadcrumb gives way first on a narrow screen: it truncates
                so the data controls on the right stay whole. */}
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="-ml-1 size-11 md:size-8" />
              <Separator orientation="vertical" className="mr-2 max-md:hidden" />
              <DashboardBreadcrumb />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
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
        <div
          data-page-panel
          className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden md:mr-2 md:mb-2 md:rounded-xl md:border"
        >
          {search.github_install === "linked" && (
            <div className="mx-3 mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
              GitHub installation linked successfully.
            </div>
          )}

          {search.github_install === "error" && (
            <div className="mx-3 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to link GitHub installation
              {search.reason ? ` (${search.reason})` : ""}.
            </div>
          )}
          {hasTimeRange ? (
            <TimeAnchorProvider>
              <Outlet />
            </TimeAnchorProvider>
          ) : (
            <Outlet />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
