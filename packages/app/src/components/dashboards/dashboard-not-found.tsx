import { Link } from "@tanstack/react-router";

/** Shared not-found UI for dashboard routes (view, settings, panel editor). */
export function DashboardNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <p className="text-lg">Dashboard not found</p>
      <Link to="/dashboards" className="text-sm underline">
        Back to dashboards
      </Link>
    </div>
  );
}
