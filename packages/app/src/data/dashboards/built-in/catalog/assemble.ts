import type { BuiltinManifestEntry } from "../manifest";

/** Validate parsed identities and use the lightweight manifest's display order. */
export function assembleBuiltinCatalog<T extends BuiltinManifestEntry>(
  manifest: readonly BuiltinManifestEntry[],
  dashboards: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const dashboard of dashboards) {
    if (byId.has(dashboard.id)) throw new Error(`Duplicate built-in dashboard: ${dashboard.id}`);
    byId.set(dashboard.id, dashboard);
  }

  const seen = new Set<string>();
  const ordered = manifest.map(({ id, name }) => {
    if (seen.has(id)) throw new Error(`Duplicate built-in manifest entry: ${id}`);
    seen.add(id);
    const dashboard = byId.get(id);
    if (!dashboard) throw new Error(`Missing built-in dashboard: ${id}`);
    if (dashboard.name !== name)
      throw new Error(`Built-in dashboard name differs from manifest: ${id}`);
    byId.delete(id);
    return dashboard;
  });
  if (byId.size)
    throw new Error(`Built-in dashboards missing from manifest: ${[...byId.keys()].join(", ")}`);
  return ordered;
}
