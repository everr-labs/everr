import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import {
  AlertCircle,
  LayoutDashboard,
  LayoutTemplate,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "@/components/dashboards/dashboard-tree";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import { dashboardListOptions } from "@/data/dashboards/options";

const ASSISTANT_DASHBOARD_PROMPT =
  "/everr-setup-resources Help me build a good first dashboard based on the telemetry we have in production";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards/",
)({
  staticData: { breadcrumb: "Dashboards" },
  head: () => ({ meta: [{ title: "Everr - Dashboards" }] }),
  component: DashboardsIndexPage,
});

function DashboardsIndexPage() {
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  const {
    data: dashboards,
    isLoading,
    isError,
    error,
  } = useQuery(dashboardListOptions(preview));
  const [search, setSearch] = useState("");
  const isEmpty = !isLoading && !isError && (dashboards?.length ?? 0) === 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Dashboards</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/dashboards/templates" />}
        >
          <LayoutTemplate className="size-3.5" />
          Create a new dashboard
        </Button>
      </div>

      {!isEmpty && (
        <div className="relative mb-4 max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search dashboards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      )}

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
        <ResourceEmptyState
          title="No dashboards yet"
          description="Pick a template and see it drawn with your own telemetry before you keep it."
          primaryAction={
            <Button render={<Link to="/dashboards/templates" />}>
              <LayoutTemplate className="size-3.5" />
              Browse templates
            </Button>
          }
          promptLabel="Or describe what you want, and let your coding assistant write the YAML:"
          assistantPrompt={ASSISTANT_DASHBOARD_PROMPT}
          docsHref="https://everr.dev/docs/learn/first-dashboard"
        />
      )}

      {!isLoading && !isError && !isEmpty && (
        <DashboardTree dashboards={dashboards ?? []} search={search} />
      )}
    </div>
  );
}
