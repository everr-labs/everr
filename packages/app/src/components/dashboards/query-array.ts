import type { Panel, PluginSpecValue } from "@/data/dashboards/schema";

const CLICKHOUSE_QUERY_KIND = "ClickHouseSQL";
const TESTDATA_QUERY_KIND = "TestData";

/** A panel query resolved to how it executes. `none` = nothing to run. */
export type PanelQuerySource =
  | { kind: "ClickHouseSQL"; sql: string }
  | { kind: "TestData"; spec: Record<string, PluginSpecValue> }
  | { kind: "none" };

export function getQuerySourceAt(
  panel: Panel,
  index: number,
): PanelQuerySource {
  const query = panel.spec.queries?.[index];
  if (!query) return { kind: "none" };
  const plugin = query.spec.plugin;
  // The schema accepts unknown query plugin kinds for Perses compatibility, so
  // gate on the plugin kind: only the kinds we execute become real sources.
  if (plugin.kind === CLICKHOUSE_QUERY_KIND) {
    return typeof plugin.spec.query === "string"
      ? { kind: "ClickHouseSQL", sql: plugin.spec.query }
      : { kind: "none" };
  }
  if (plugin.kind === TESTDATA_QUERY_KIND) {
    return { kind: "TestData", spec: plugin.spec };
  }
  return { kind: "none" };
}

export function getPanelQuerySources(panel: Panel): PanelQuerySource[] {
  return (panel.spec.queries ?? []).map((_, i) => getQuerySourceAt(panel, i));
}

/** SQL text for a ClickHouseSQL query, else "" — for SQL-only callers/tests. */
export function getQueryTextAt(panel: Panel, index: number): string {
  const source = getQuerySourceAt(panel, index);
  return source.kind === "ClickHouseSQL" ? source.sql : "";
}

export function getQueryTexts(panel: Panel): string[] {
  return (panel.spec.queries ?? []).map((_, i) => getQueryTextAt(panel, i));
}
