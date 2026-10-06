import * as z from "zod";

/**
 * The panel key shown full page. Absent means the grid. An empty or
 * non-string value is dropped so a bad link falls back to the grid instead
 * of opening a blank stage.
 *
 * Not retained across navigation: a key belongs to one dashboard. The shared
 * link already names both the dashboard and the panel.
 */
const panelSearchField = z.string().min(1).optional().catch(undefined);

/** Home, which has no rail flag. */
export const panelSearchSchema = z.object({
  panel: panelSearchField,
});

/** Dashboards rail: `full` hides the list, `panel` opens one panel. */
export const dashboardFrameSearchSchema = z.object({
  full: z.boolean().optional().catch(undefined),
  panel: panelSearchField,
});

export function readPanelKey(search: unknown): string | undefined {
  if (typeof search !== "object" || search === null || !("panel" in search)) {
    return undefined;
  }
  const panel = search.panel;
  return typeof panel === "string" && panel.length > 0 ? panel : undefined;
}
