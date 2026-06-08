import { Link } from "@tanstack/react-router";

/** Shown when a dashboard route resolves to a slug that doesn't exist. */
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
