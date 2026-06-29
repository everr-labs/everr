import { Link } from "@tanstack/react-router";

/** Shown when a runbook route resolves to a slug that doesn't exist. */
export function RunbookNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <p className="text-lg">Runbook not found</p>
      <Link to="/runbooks" className="text-sm underline">
        Back to runbooks
      </Link>
    </div>
  );
}
