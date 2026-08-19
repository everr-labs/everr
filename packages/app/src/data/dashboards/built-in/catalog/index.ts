import { parse } from "yaml";
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
