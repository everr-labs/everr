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
  const existing = queries[index];
  // Update the query string in place on the existing query, preserving its
  // kind and any other plugin spec fields (imported dashboards may carry more
  // than just `query`). Only when there's no existing query do we create a
  // fresh ClickHouseSQL one.
  queries[index] = existing
    ? {
        ...existing,
        spec: {
          ...existing.spec,
          plugin: {
            ...existing.spec.plugin,
            spec: { ...existing.spec.plugin.spec, query },
          },
        },
      }
    : makeClickHouseQuery(query);
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
