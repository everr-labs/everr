import type { QueryClient } from "@tanstack/react-query";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";
import { lastViewedRunbook } from "@/data/runbooks/last-viewed";
import { runbookOptions } from "@/data/runbooks/options";
import { findPage } from "@/data/runbooks/pages";
import type { BreadcrumbSegment } from "@/router-types";

/**
 * Shared route config for the runbook index and splat routes, which differ
 * only in their component. Keeping the breadcrumb, head, and loader here avoids
 * the two route files drifting apart.
 */
export const runbookBreadcrumb = (match: {
  params: { project: string; slug: string };
  loaderData?: { name: string; pageTitle?: string };
}): BreadcrumbSegment[] => {
  const name = match.loaderData?.name ?? "Runbook";
  const pageTitle = match.loaderData?.pageTitle;
  const runbooks = { label: "Runbooks", to: "/runbooks" };
  // On the index page the runbook is where you are; on one of its pages it
  // becomes the way back, and the page names the place.
  if (pageTitle === undefined) return [runbooks, { label: name }];
  return [
    runbooks,
    {
      label: name,
      to: `/runbooks/${match.params.project}/${match.params.slug}`,
    },
    { label: pageTitle },
  ];
};

export const runbookHead = () => ({ meta: [{ title: "Everr - Runbook" }] });

export async function loadRunbook({
  queryClient,
  org,
  project,
  slug,
  preview,
  pagePath = "",
  preload,
}: {
  queryClient: QueryClient;
  org: string;
  project: string;
  slug: string;
  preview?: string;
  /** "" = the runbook's own index page. */
  pagePath?: string;
  preload: boolean;
}) {
  // A missing runbook throws notFound() from the server fn (→ notFound UI);
  // any other failure propagates to the error boundary instead of being
  // masked as not-found.
  const { document, previewStatus } = await queryClient.ensureQueryData(
    runbookOptions(project, slug, preview),
  );
  // Preloads (link hover) run this loader too; only a committed navigation
  // counts as "viewed".
  if (!preload) lastViewedRunbook.record(org, { project, slug });
  // Expose the runbook's duration/refreshInterval as route time defaults so
  // the time-range hooks seed the picker and panels from the first render —
  // no post-mount URL write, so panels never query the wrong window first.
  // `previewStatus` rides the loaderData up to the `_previewable` layout, which
  // reads the deepest match carrying it to tone the shared preview pill.
  return {
    name: document.spec.display?.name ?? slug,
    // A page the runbook doesn't have leaves this undefined, so the breadcrumb
    // stops at the runbook rather than naming a page the pane cannot show.
    pageTitle: pagePath ? findPage(document.spec, pagePath)?.title : undefined,
    previewStatus,
    timeDefaults: dashboardTimeDefaults(document.spec),
  };
}
