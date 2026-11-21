import { EverrLogoMark } from "@everr/ui/components/everr-logo";
import { Separator } from "@everr/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@everr/ui/components/sidebar";
import { cn } from "@everr/ui/lib/utils";
import type { QueryFilters } from "@tanstack/react-query";
import { Link, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ShellBreadcrumb } from "./breadcrumb";
import { RefreshPicker, TimeRangePicker } from "./header-controls";
import { NavMain, type NavGroup } from "./nav";
import { SIDEBAR_TRACKED_LEFT } from "./sidebar-tracked-left";
import { useOnNavigate } from "./use-on-navigate";

/**
 * The frame every Everr app renders: the sidebar, the header (breadcrumb, time
 * range, refresh) and the page panel. Mount it in the component of the layout
 * route that spreads `shellRouteOptions`.
 */
export function AppShell({
  nav,
  sidebarFooter,
  dataActions,
  hideTimeRangePicker: hideTimeRangePickerOverride,
  refreshScope,
  children,
}: {
  /** The sidebar groups, top to bottom. */
  nav: readonly NavGroup[];
  sidebarFooter: ReactNode;
  /** Header items before the time range, on the pages that show data controls. */
  dataActions?: ReactNode;
  /** When set, wins over what the matched routes declare in `staticData`. */
  hideTimeRangePicker?: boolean;
  /**
   * The queries a refresh covers and the refresh picker waits for: every query
   * when omitted. Pass a constant, as a new object restarts the auto-refresh
   * timer on each render.
   */
  refreshScope?: QueryFilters;
  /** The page panel's content. */
  children: ReactNode;
}) {
  // Structurally shared: the router updates matches at every navigation step,
  // and re-rendering the whole shell on each was most of a navigation's cost.
  const matches = useMatches({
    select: (all) =>
      all.map((match) => ({
        showDataControls: match.staticData.showDataControls,
        hideTimeRangePicker: match.staticData.hideTimeRangePicker,
      })),
    structuralSharing: true,
  });
  const showDataControls = matches.some((match) => match.showDataControls);
  let hideTimeRangePicker = false;
  for (const match of matches) {
    if (match.hideTimeRangePicker !== undefined) {
      hideTimeRangePicker = match.hideTimeRangePicker;
    }
  }
  if (hideTimeRangePickerOverride !== undefined) {
    hideTimeRangePicker = hideTimeRangePickerOverride;
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
      <AppSidebar nav={nav} footer={sidebarFooter} />
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
              <ShellBreadcrumb nav={nav} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {showDataControls && dataActions}

              {showDataControls && !hideTimeRangePicker && (
                <>
                  <TimeRangePicker />
                  <RefreshPicker scope={refreshScope} />
                </>
              )}
            </div>
          </div>
        </header>
        <div
          data-page-panel
          className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden md:mr-2 md:mb-2 md:rounded-xl md:border"
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar({ nav, footer }: { nav: readonly NavGroup[]; footer: ReactNode }) {
  // On a phone the sidebar is a sheet over the page, which a navigation from
  // it, or from a menu portaled outside it, should leave.
  const { setOpenMobile } = useSidebar();
  useOnNavigate(() => setOpenMobile(false));
  return (
    <Sidebar collapsible="icon" className="group-data-[side=left]:border-r-0">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <EverrLogoMark className="size-8!" aria-hidden="true" />
              <div className="grid flex-1 text-left text-sm leading-tight transition-opacity duration-200 ease-sidebar motion-reduce:transition-none group-data-[collapsible=icon]:opacity-0">
                <span className="overflow-hidden whitespace-nowrap font-semibold text-white">
                  everr
                </span>
                <span className="overflow-hidden whitespace-nowrap text-xs">
                  Observability made simple
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={nav} />
      </SidebarContent>
      <SidebarFooter>{footer}</SidebarFooter>
      {/* The page panel lights its left edge on rail hover (shell.css). */}
      <SidebarRail className="hover:after:bg-transparent" />
    </Sidebar>
  );
}
