import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutDashboard, Plus, SearchIcon } from "lucide-react";
import { useState } from "react";
import { dashboardListOptions } from "@/data/dashboards/options";

export const Route = createFileRoute("/_authenticated/_dashboard/dashboards/")({
  staticData: { breadcrumb: "Dashboards" },
  head: () => ({
    meta: [{ title: "Everr - Dashboards" }],
  }),
  component: DashboardsIndexPage,
});

function DashboardsIndexPage() {
  const { data: dashboards, isLoading } = useQuery(dashboardListOptions());
  const [search, setSearch] = useState("");

  const filtered = dashboards?.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Dashboards</h1>
        </div>
        <Button size="sm" render={<Link to="/dashboards/new" />}>
          <Plus data-icon="inline-start" />
          New Dashboard
        </Button>
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

      {filtered && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <LayoutDashboard className="size-10" />
          <p className="text-sm">
            {search ? "No dashboards match your search" : "No dashboards yet"}
          </p>
          {!search && (
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/dashboards/new" />}
            >
              <Plus data-icon="inline-start" />
              Create your first dashboard
            </Button>
          )}
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <Link
              key={d.slug}
              to="/dashboards/$dashboardId"
              params={{ dashboardId: d.slug }}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <LayoutDashboard className="size-4 text-muted-foreground" />
                <span className="font-medium">{d.name}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{d.slug}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
