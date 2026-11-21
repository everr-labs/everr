import { notFound } from "@tanstack/react-router";
import { getBuiltinDashboard } from "#app/data/dashboards/built-in/catalog/index.ts";
import { cachedDashboard } from "#app/data/dashboards/options.ts";
import type { Panel } from "#app/data/dashboards/schema.ts";
import type { BreadcrumbContext, BreadcrumbSegment } from "#app/router-types.ts";

/**
 * Shared route config for the two maximized-panel routes (own and built-in
 * dashboards), which differ only in where the document comes from.
 */

/**
 * Appended to the dashboard's own crumbs, which turns the dashboard name into
 * the way back.
 */
export const panelBreadcrumb = (
  match: {
    params: { project?: string; slug: string; panelKey: string };
    search: { preview?: string };
    loaderData?: { panelName: string };
  },
  { queryClient }: BreadcrumbContext,
): BreadcrumbSegment[] => {
  const { project, slug, panelKey } = match.params;
  // Before the loader answers, the name comes from the dashboard document the
  // user is maximizing the panel from, which is already cached (own) or
  // bundled (built-in).
  const document =
    project === undefined
      ? getBuiltinDashboard(slug)?.document
      : cachedDashboard(queryClient, project, slug, match.search.preview)?.document;
  const name = match.loaderData?.panelName ?? panelName(document?.spec.panels, panelKey);
  return [{ label: name ?? "Panel", unresolved: name === undefined }];
};

function panelName(panels: Record<string, Panel> | undefined, panelKey: string) {
  const panel = panels?.[panelKey];
  return panel && (panel.spec.display?.name ?? panelKey);
}

/**
 * Loader data for one panel of a document. `panels` is undefined when the
 * dashboard itself is missing; the layout loader above reports that one.
 */
export function loadPanel(panels: Record<string, Panel> | undefined, panelKey: string) {
  const name = panelName(panels, panelKey);
  if (name === undefined) throw notFound();
  return { panelName: name };
}
