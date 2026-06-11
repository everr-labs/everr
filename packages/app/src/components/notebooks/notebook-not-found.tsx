import { Link } from "@tanstack/react-router";

/** Shown when a notebook route resolves to a slug that doesn't exist. */
export function NotebookNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <p className="text-lg">Notebook not found</p>
      <Link to="/notebooks" className="text-sm underline">
        Back to notebooks
      </Link>
    </div>
  );
}
