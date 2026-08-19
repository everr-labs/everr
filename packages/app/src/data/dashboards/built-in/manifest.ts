/**
 * The catalog's identity strip — id and name only — for surfaces that list
 * built-ins without rendering them (the command bar in the app shell). A
 * hand-written literal rather than a derivation: importing the catalog pulls
 * thousands of lines of panel SQL into the importer's bundle and evaluates
 * them at startup. `manifest.test.ts` asserts this list matches the catalog
 * exactly, so the duplication cannot drift.
 *
 * Ordered like the catalog: by category, then declaration order.
 */
export interface BuiltinManifestEntry {
  id: string;
  name: string;
}

export const BUILTIN_MANIFEST: BuiltinManifestEntry[] = [
  { id: "http-endpoints", name: "HTTP Endpoints" },
  { id: "rpc-services", name: "RPC Services" },
  { id: "server-functions", name: "Server Functions" },
  { id: "serverless-functions", name: "Serverless Functions" },
  { id: "log-overview", name: "Log Overview" },
  { id: "traces-overview", name: "Traces Overview" },
  { id: "metric-overview", name: "Metric Overview" },
  { id: "jvm-runtime", name: "JVM Runtime" },
  { id: "nodejs-runtime", name: "Node.js Runtime" },
  { id: "postgres-overview", name: "Postgres Overview" },
  { id: "mysql-overview", name: "MySQL Overview" },
  { id: "redis-overview", name: "Redis Overview" },
  { id: "mongodb-overview", name: "MongoDB Overview" },
  { id: "kubernetes-workloads", name: "Kubernetes Workloads" },
  { id: "web-vitals", name: "Web Vitals" },
  { id: "product-analytics", name: "Product Analytics" },
];
