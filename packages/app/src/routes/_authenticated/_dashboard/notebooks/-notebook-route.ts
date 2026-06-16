import type { QueryClient } from "@tanstack/react-query";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";
import { notebookOptions } from "@/data/notebooks/options";

/**
 * Shared route config for the notebook index and splat routes, which differ
 * only in their component. Keeping the breadcrumb, head, and loader here avoids
 * the two route files drifting apart.
 */
export const notebookBreadcrumb = (match: {
  loaderData?: { name: string };
}) => [
  { label: "Notebooks", to: "/notebooks" as const },
  { label: match.loaderData?.name ?? "Notebook" },
];

export const notebookHead = () => ({ meta: [{ title: "Everr - Notebook" }] });

export async function loadNotebook(
  queryClient: QueryClient,
  project: string,
  slug: string,
) {
  // A missing notebook throws notFound() from the server fn (→ notFound UI);
  // any other failure propagates to the error boundary instead of being
  // masked as not-found.
  const notebook = await queryClient.ensureQueryData(
    notebookOptions(project, slug),
  );
  // Expose the notebook's duration/refreshInterval as route time defaults so
  // the time-range hooks seed the picker and panels from the first render —
  // no post-mount URL write, so panels never query the wrong window first.
  return {
    name: notebook.spec.display?.name ?? slug,
    timeDefaults: dashboardTimeDefaults(notebook.spec),
  };
}
