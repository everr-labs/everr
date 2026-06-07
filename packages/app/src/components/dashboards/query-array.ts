import type { Panel, PanelQuery } from "@/data/dashboards/schema";

function makeClickHouseQuery(query: string): PanelQuery {
  return {
    kind: "ClickHouseSQL",
    spec: { plugin: { kind: "ClickHouseSQL", spec: { query } } },
  };
}

export function getQueryTextAt(panel: Panel, index: number): string {
  const query = panel.spec.queries?.[index];
  if (!query) return "";
  const spec = query.spec.plugin.spec;
  return typeof spec.query === "string" ? spec.query : "";
}

export function getQueryTexts(panel: Panel): string[] {
  return (panel.spec.queries ?? []).map((_, i) => getQueryTextAt(panel, i));
}

export function setQueryTextAt(
  panel: Panel,
  index: number,
  query: string,
): Panel {
  const queries = [...(panel.spec.queries ?? [])];
  queries[index] = makeClickHouseQuery(query);
  return { ...panel, spec: { ...panel.spec, queries } };
}

export function addQuery(panel: Panel): Panel {
  const queries = [...(panel.spec.queries ?? []), makeClickHouseQuery("")];
  return { ...panel, spec: { ...panel.spec, queries } };
}

export function removeQueryAt(panel: Panel, index: number): Panel {
  const queries = (panel.spec.queries ?? []).filter((_, i) => i !== index);
  return { ...panel, spec: { ...panel.spec, queries } };
}
