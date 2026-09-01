import type { SpecDeprecation } from "@/components/dashboards/visualizations/deprecations";
import { panelPluginDeprecations } from "./plugin-specs";

/**
 * Deprecated options set by one panel's plugin block.
 *
 * Reads defensively: the apply path scans documents that have already passed
 * strict validation, but a deprecated option is by definition one the schema
 * still accepts, so nothing here may assume a shape.
 */
export function collectPanelDeprecations(plugin: unknown): SpecDeprecation[] {
  const kind = (plugin as { kind?: unknown } | null | undefined)?.kind;
  if (typeof kind !== "string") return [];
  const collect = panelPluginDeprecations[kind];
  if (!collect) return [];
  return collect((plugin as { spec?: unknown }).spec);
}

/** One line per deprecated option, naming the file the author has to edit. */
export function formatDeprecation(
  path: string,
  panelKey: string,
  deprecation: SpecDeprecation,
): string {
  return `${path}: panel "${panelKey}" — ${deprecation.message} (${deprecation.fix})`;
}

/**
 * Deprecation warnings for a document's `spec.panels` map. Shared by dashboards
 * and runbooks, which carry the same panels map; runbooks add their inline
 * markdown embeds on top.
 */
export function collectPanelsMapWarnings(
  path: string,
  document: unknown,
): string[] {
  const panels = (
    document as { spec?: { panels?: unknown } } | null | undefined
  )?.spec?.panels;
  if (!panels || typeof panels !== "object") return [];

  const warnings: string[] = [];
  for (const [key, panel] of Object.entries(
    panels as Record<string, unknown>,
  )) {
    const plugin = (panel as { spec?: { plugin?: unknown } })?.spec?.plugin;
    for (const deprecation of collectPanelDeprecations(plugin)) {
      warnings.push(formatDeprecation(path, key, deprecation));
    }
  }
  return warnings;
}
