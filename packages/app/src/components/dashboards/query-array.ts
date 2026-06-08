import type { Panel } from "@/data/dashboards/schema";

export function getQueryTextAt(panel: Panel, index: number): string {
  const query = panel.spec.queries?.[index];
  if (!query) return "";
  const spec = query.spec.plugin.spec;
  return typeof spec.query === "string" ? spec.query : "";
}

export function getQueryTexts(panel: Panel): string[] {
  return (panel.spec.queries ?? []).map((_, i) => getQueryTextAt(panel, i));
}
