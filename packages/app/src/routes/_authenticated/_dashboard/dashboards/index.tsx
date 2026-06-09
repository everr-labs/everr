import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, LayoutDashboard, SearchIcon } from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "@/components/dashboards/dashboard-tree";
import { dashboardListOptions } from "@/data/dashboards/options";

export const Route = createFileRoute("/_authenticated/_dashboard/dashboards/")({
  staticData: { breadcrumb: "Dashboards" },
  head: () => ({ meta: [{ title: "Everr - Dashboards" }] }),
  component: DashboardsIndexPage,
});

function DashboardsIndexPage() {
  const {
    data: dashboards,
    isLoading,
    isError,
    error,
  } = useQuery(dashboardListOptions());
  const [search, setSearch] = useState("");
  const isEmpty = !isLoading && !isError && (dashboards?.length ?? 0) === 0;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <LayoutDashboard className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Dashboards</h1>
      </div>

      <div className="relative mb-4 max-w-sm">
        <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search dashboards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && isError && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <AlertCircle className="size-10" />
          <p className="text-sm">
            {error instanceof Error
              ? error.message
              : "Failed to load dashboards"}
          </p>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <LayoutDashboard className="size-10" />
          <p className="text-sm">
            No dashboards yet — apply some with the everr CLI
          </p>
        </div>
      )}

      {!isLoading && !isError && !isEmpty && (
        <DashboardTree dashboards={dashboards ?? []} search={search} />
      )}
    </div>
  );
}
