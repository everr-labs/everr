import { parse } from "yaml";
import { dashboardSlugSchema, dashboardSpecSchemaStrict } from "../../schema";
import type { BuiltinDashboard } from "../types";

/**
 * Every Built-in dashboard is one plain YAML file under a category directory,
 * in the same shape `everr apply` reads, plus the catalog fields (`id`,
 * `name`, `description`, `category`, `requires`). The files are inlined raw at
 * build time and parsed once at module init. Nothing here is stored per
 * Organization: built-ins render live from the catalog under the reserved
 * `built-in` pseudo-project, and an editable copy is only ever made by an
 * Agent applying it as code (ADR 0004).
 */
const sources = import.meta.glob("./*/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Display order of the list, category shelf by category shelf. A new YAML file
 * is not picked up until it is placed here, which is deliberate: the order on
 * the shelf is an editorial decision, not an accident of the filesystem.
 */
const ORDER = [
  // Application
  "http-endpoints",
  "rpc-services",
  "server-functions",
  "serverless-functions",
  "log-overview",
  "traces-overview",
  // Runtime
  "metric-overview",
  "jvm-runtime",
  "nodejs-runtime",
  // Databases
  "postgres-overview",
  "mysql-overview",
  "redis-overview",
  "mongodb-overview",
  // Infrastructure
  "kubernetes-workloads",
  // Browser
  "web-vitals",
  "product-analytics",
];

export const BUILTIN_DASHBOARDS: BuiltinDashboard[] = Object.values(sources)
  .map((source) => {
    const builtin = parse(source) as BuiltinDashboard;
    if (!ORDER.includes(builtin.id)) {
      throw new Error(`Builtin ${builtin.id} is missing from ORDER`);
    }
    return builtin;
  })
  .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

const BY_ID = new Map(BUILTIN_DASHBOARDS.map((t) => [t.id, t]));

export function getBuiltinDashboard(id: string): BuiltinDashboard | undefined {
  return BY_ID.get(id);
}

/**
 * Validates the whole catalog against the same strict schema `everr apply`
 * uses, so a builtin that would be rejected as a file is rejected here too.
 * Exported for the catalog test rather than run at import time: the list
 * must not pay for validation on every page load.
 */
export function validateCatalog(): void {
  const ids = new Set<string>();
  for (const builtin of BUILTIN_DASHBOARDS) {
    if (ids.has(builtin.id)) {
      throw new Error(`Duplicate builtin id: ${builtin.id}`);
    }
    ids.add(builtin.id);
    // The id is the slug in `/dashboards/built-in/$slug` and in `everr
    // resources show`, so it answers to the same rule every as-code slug does.
    dashboardSlugSchema.parse(builtin.id);
    dashboardSpecSchemaStrict.parse(builtin.document.spec);
  }
}
