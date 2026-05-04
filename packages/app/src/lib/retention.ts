export type Tier = "free" | "pro";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

const RETENTION_BY_TIER: Record<Tier, TenantRetention> = {
  free: { tracesDays: 30, logsDays: 30, metricsDays: 30 },
  // Metrics retention is "13 months" — Datadog/industry convention, stored
  // here as 395 days (~13 × 30.4).
  pro: { tracesDays: 90, logsDays: 90, metricsDays: 395 },
};

export function resolveRetention(tier: Tier): TenantRetention {
  return RETENTION_BY_TIER[tier];
}
