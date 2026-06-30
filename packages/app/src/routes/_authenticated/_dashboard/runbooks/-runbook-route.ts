import type { QueryClient } from "@tanstack/react-query";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";
import { breadcrumbSegments } from "@/data/dashboards/tree";
import { runbookOptions } from "@/data/runbooks/options";

/**
 * Shared route config for the runbook index and splat routes, which differ
 * only in their component. Keeping the breadcrumb, head, and loader here avoids
 * the two route files drifting apart.
 */
export const runbookBreadcrumb = (match: {
  loaderData?: { name: string; folderPath?: string };
}) => [
  { label: "Runbooks", to: "/runbooks" as const },
  ...breadcrumbSegments(match.loaderData?.folderPath ?? "").map((seg) => ({
    label: seg.name,
    to: "/runbooks" as const,
    search: { folder: seg.path },
  })),
  { label: match.loaderData?.name ?? "Runbook" },
];

export const runbookHead = () => ({ meta: [{ title: "Everr - Runbook" }] });

export async function loadRunbook(
  queryClient: QueryClient,
  project: string,
  slug: string,
) {
  // A missing runbook throws notFound() from the server fn (→ notFound UI);
  // any other failure propagates to the error boundary instead of being
  // masked as not-found.
  const runbook = await queryClient.ensureQueryData(
    runbookOptions(project, slug),
  );
  // Expose the runbook's duration/refreshInterval as route time defaults so
  // the time-range hooks seed the picker and panels from the first render —
  // no post-mount URL write, so panels never query the wrong window first.
  return {
    name: runbook.spec.display?.name ?? slug,
    folderPath: runbook.folderPath,
    timeDefaults: dashboardTimeDefaults(runbook.spec),
  };
}
