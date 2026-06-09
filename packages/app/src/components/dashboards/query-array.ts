import type { Panel } from "@/data/dashboards/schema";

/** The only query plugin Everr executes; everything else is read as no SQL. */
const CLICKHOUSE_QUERY_KIND = "ClickHouseSQL";

export function getQueryTextAt(panel: Panel, index: number): string {
  const query = panel.spec.queries?.[index];
  if (!query) return "";
  const plugin = query.spec.plugin;
  // The schema accepts unknown query plugin kinds for Perses compatibility, so
  // gate on the plugin kind: a non-ClickHouse plugin that happens to carry a
  // string `query` field must NOT be run as ClickHouse SQL — treat it as no SQL.
  if (plugin.kind !== CLICKHOUSE_QUERY_KIND) return "";
  return typeof plugin.spec.query === "string" ? plugin.spec.query : "";
}

export function getQueryTexts(panel: Panel): string[] {
  return (panel.spec.queries ?? []).map((_, i) => getQueryTextAt(panel, i));
}
