import { notFound } from "@tanstack/react-router";
import type { Panel } from "#app/data/dashboards/schema.ts";

/**
 * Shared route config for the two maximized-panel routes (own and built-in
 * dashboards), which differ only in where the document comes from.
 */

/**
 * Appended to the dashboard's own crumbs, which turns the dashboard name into
 * the way back.
 */
export const panelBreadcrumb = (match: { loaderData?: { panelName: string } }) =>
  match.loaderData?.panelName ?? "Panel";

/**
 * Loader data for one panel of a document. `panels` is undefined when the
 * dashboard itself is missing; the layout loader above reports that one.
 */
export function loadPanel(panels: Record<string, Panel> | undefined, panelKey: string) {
  const panel = panels?.[panelKey];
  if (!panel) throw notFound();
  return { panelName: panel.spec.display?.name ?? panelKey };
}
