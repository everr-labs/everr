import type { QueryClient } from "@tanstack/react-query";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";
import { runbookOptions } from "@/data/runbooks/options";

/**
 * Shared route config for the runbook index and splat routes, which differ
 * only in their component. Keeping the breadcrumb, head, and loader here avoids
 * the two route files drifting apart.
 */
export const runbookBreadcrumb = (match: { loaderData?: { name: string } }) => [
  { label: "Runbooks", to: "/runbooks" as const },
  { label: match.loaderData?.name ?? "Runbook" },
];

export const runbookHead = () => ({ meta: [{ title: "Everr - Runbook" }] });

export async function loadRunbook(
  queryClient: QueryClient,
  project: string,
  slug: string,
  preview?: string,
) {
  // A missing runbook throws notFound() from the server fn (→ notFound UI);
  // any other failure propagates to the error boundary instead of being
  // masked as not-found.
  const { document, previewStatus } = await queryClient.ensureQueryData(
    runbookOptions(project, slug, preview),
  );
  // Expose the runbook's duration/refreshInterval as route time defaults so
  // the time-range hooks seed the picker and panels from the first render —
  // no post-mount URL write, so panels never query the wrong window first.
  // `previewStatus` rides the loaderData up to the `_previewable` layout, which
  // reads the deepest match carrying it to tone the shared preview pill.
  return {
    name: document.spec.display?.name ?? slug,
    previewStatus,
    timeDefaults: dashboardTimeDefaults(document.spec),
  };
}
