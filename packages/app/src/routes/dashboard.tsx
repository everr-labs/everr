import {
  createFileRoute,
  Outlet,
  retainSearchParams,
  stripSearchParams,
  useMatches,
} from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { RefreshPicker, TimeRangePicker } from "@/components/analytics";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandBar } from "@/components/command-bar";
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { DEFAULT_TIME_RANGE, TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  validateSearch: TimeRangeSearchSchema,
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
  component: RouteComponent,
});

function RouteComponent() {
  const [commandBarOpen, setCommandBarOpen] = useState(false);

  const toggleCommandBar = useCallback((open: boolean) => {
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        flushSync(() => setCommandBarOpen(open));
      });
    } else {
      setCommandBarOpen(open);
    }
  }, []);

  const matches = useMatches();
  let hideTimeRangePicker = false;
  for (const match of matches) {
    if (match.staticData?.hideTimeRangePicker !== undefined) {
      hideTimeRangePicker = match.staticData.hideTimeRangePicker;
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandBar(!commandBarOpen);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commandBarOpen, toggleCommandBar]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-screen">
        <header className="flex h-12 border-b border-sidebar-border px-3 bg-sidebar">
          <div className="flex items-center justify-between flex-1">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2" />
              <DashboardBreadcrumb />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleCommandBar(true)}
                style={{
                  viewTransitionName: commandBarOpen
                    ? undefined
                    : "command-bar",
                }}
                className="flex h-7 w-52 items-center gap-2 rounded-md border border-input bg-input/20 px-2 text-xs text-muted-foreground transition-colors hover:bg-input/40 dark:bg-input/30"
              >
                <SearchIcon className="size-3.5 shrink-0" />
                <span className="flex-1 text-left">Search...</span>
                <kbd className="pointer-events-none flex h-4 items-center gap-0.5 rounded bg-muted-foreground/10 px-1 font-mono text-[0.625rem] text-muted-foreground">
                  <span className="text-[0.75rem]">⌘</span>K
                </kbd>
              </button>
              {!hideTimeRangePicker && (
                <>
                  <TimeRangePicker />
                  <RefreshPicker />
                </>
              )}
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandBar open={commandBarOpen} onOpenChange={toggleCommandBar} />
    </SidebarProvider>
  );
}
