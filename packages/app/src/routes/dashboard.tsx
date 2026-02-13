import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { TimeRangePicker } from "@/components/analytics";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: RouteComponent,
});

function RouteComponent() {
  const matches = useMatches();
  let hideTimeRangePicker = false;
  for (const match of matches) {
    if (match.staticData?.hideTimeRangePicker !== undefined) {
      hideTimeRangePicker = match.staticData.hideTimeRangePicker;
    }
  }

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
            {!hideTimeRangePicker && <TimeRangePicker />}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
