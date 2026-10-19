import { dashboards } from "@composition/dashboards";

import { BUILTIN_MANIFEST } from "../manifest";
import { parseBuiltinDashboard } from "../parse";
import type { BuiltinDashboard } from "../types";
import { assembleBuiltinCatalog } from "./assemble";

const { additionalBuiltinDashboards } = dashboards;

/**
 * Shared dashboards are plain YAML files under category directories. The
 * active app can add dashboards through the dashboard composition. All files
 * use the shape `everr apply` reads, plus catalog fields, and are parsed once
 * at module init. Built-ins render live from this catalog under the reserved
 * `built-in` pseudo-project (ADR 0004).
 */
const sources = import.meta.glob<string>("./*/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const BUILTIN_DASHBOARDS: BuiltinDashboard[] = assembleBuiltinCatalog(
  BUILTIN_MANIFEST,
  [
    ...Object.values(sources).map(parseBuiltinDashboard),
    ...additionalBuiltinDashboards,
  ],
);

const BY_ID = new Map(BUILTIN_DASHBOARDS.map((t) => [t.id, t]));

export function getBuiltinDashboard(id: string): BuiltinDashboard | undefined {
  return BY_ID.get(id);
}
