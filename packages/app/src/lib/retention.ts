export type Tier = "free" | "pro";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

// Every value here must be in the bounded set of
// clickhouse/init/05-create-retention-function.sql: rows are stamped with
// their retention and partitioned by it, and a value outside the set collapses
// to the shortest one.
const RETENTION_BY_TIER: Record<Tier, TenantRetention> = {
  free: { tracesDays: 7, logsDays: 7, metricsDays: 14 },
  // Metrics retention is "13 months" — Datadog/industry convention, stored
  // here as 395 days (~13 × 30.4).
  pro: { tracesDays: 90, logsDays: 90, metricsDays: 395 },
};

export function resolveRetention(tier: Tier): TenantRetention {
  return RETENTION_BY_TIER[tier];
}
