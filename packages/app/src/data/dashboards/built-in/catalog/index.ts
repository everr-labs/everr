import { additionalBuiltinDashboards } from "@app/dashboard-catalog";
import { parse } from "yaml";
import type { BuiltinDashboard } from "../types";

/**
 * Shared dashboards are plain YAML files under category directories. The
 * active app can add dashboards through @app/dashboard-catalog. All files
 * use the shape `everr apply` reads, plus catalog fields, and are parsed once
 * at module init. Built-ins render live from this catalog under the reserved
 * `built-in` pseudo-project (ADR 0004).
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
const builtins: BuiltinDashboard[] = [
  ...Object.values(sources).map((source) => parse(source) as BuiltinDashboard),
  ...additionalBuiltinDashboards,
];

const ORDER = [
  "http-endpoints",
  "rpc-services",
  "server-functions",
  "serverless-functions",
  "log-overview",
  "traces-overview",
  "metric-overview",
  "jvm-runtime",
  "nodejs-runtime",
  "postgres-overview",
  "mysql-overview",
  "redis-overview",
  "mongodb-overview",
  "kubernetes-workloads",
  ...additionalBuiltinDashboards.map(({ id }) => id),
  "web-vitals",
  "product-analytics",
];

export const BUILTIN_DASHBOARDS: BuiltinDashboard[] = builtins
  .map((builtin) => {
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
