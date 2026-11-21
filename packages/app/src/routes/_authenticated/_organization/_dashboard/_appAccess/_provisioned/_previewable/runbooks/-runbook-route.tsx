import type { QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { dashboardTimeDefaults } from "#app/data/dashboards/time-defaults.ts";
import { cachedRunbookNames, runbookOptions } from "#app/data/runbooks/options.ts";
import { findPage, toDashboardDocument } from "#app/data/runbooks/pages.ts";
import type { BreadcrumbContext, BreadcrumbSegment } from "#app/router-types.ts";

/**
 * Shared route config for the runbook index and splat routes, which differ
 * only in their component. Keeping the breadcrumb, head, and loader here avoids
 * the two route files drifting apart.
 */
export const runbookBreadcrumb = (
  match: {
    params: { project: string; slug: string; _splat?: string };
    search: { preview?: string };
    loaderData?: { name: string; pageTitle?: string };
  },
  { queryClient }: BreadcrumbContext,
): BreadcrumbSegment[] => {
  const { project, slug, _splat: pagePath = "" } = match.params;
  const loaded = match.loaderData;
  // Before the loader answers, the names come from the cache.
  const { name, pageTitle } =
    loaded ?? cachedRunbookNames(queryClient, project, slug, match.search.preview, pagePath);
  const runbooks = { label: "Runbooks", link: <Link to="/runbooks" /> };
  const runbook = { label: name ?? "Runbook", unresolved: name === undefined };
  // On the index page the runbook is where you are; on one of its pages it
  // becomes the way back, and the page names the place. Once loaded, a page the
  // runbook lacks stops the breadcrumb at the runbook.
  if (!pagePath || (loaded && pageTitle === undefined)) return [runbooks, runbook];
  return [
    runbooks,
    { ...runbook, link: <Link to="/runbooks/$project/$slug" params={{ project, slug }} /> },
    { label: pageTitle ?? "Page", unresolved: pageTitle === undefined },
  ];
};

export const runbookHead = () => ({ meta: [{ title: "Everr - Runbook" }] });

export async function loadRunbook({
  queryClient,
  project,
  slug,
  preview,
  pagePath = "",
}: {
  queryClient: QueryClient;
  project: string;
  slug: string;
  preview?: string;
  /** "" = the runbook's own index page. */
  pagePath?: string;
}) {
  // A missing runbook throws notFound() from the server fn (→ notFound UI);
  // any other failure propagates to the error boundary instead of being
  // masked as not-found.
  const { document, previewStatus } = await queryClient.ensureQueryData(
    runbookOptions(project, slug, preview),
  );
  const dashboard = toDashboardDocument(document, project, slug);
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
    timeDefaults: dashboardTimeDefaults(dashboard.spec),
  };
}
