import { productClient } from "@composition/client";

/** Lightweight identities; dashboard documents stay in the catalog module. */
export interface BuiltinManifestEntry {
  readonly id: string;
  readonly name: string;
}

const serviceDashboards = [
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
] as const satisfies readonly BuiltinManifestEntry[];

const browserDashboards = [
  { id: "web-vitals", name: "Web Vitals" },
  { id: "product-analytics", name: "Product Analytics" },
] as const satisfies readonly BuiltinManifestEntry[];

export type SharedBuiltinDashboardId =
  | (typeof serviceDashboards)[number]["id"]
  | (typeof browserDashboards)[number]["id"];

/** Application additions sit between service and browser dashboards. */
export const BUILTIN_MANIFEST: readonly BuiltinManifestEntry[] = [
  ...serviceDashboards,
  ...productClient.additionalBuiltinManifest,
  ...browserDashboards,
];
