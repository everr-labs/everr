export type Tier = "free" | "pro";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

// Daily partitions are keyed by retention_days. Keep the distinct windows
// bounded; their sum determines the approximate live partition count per table.
const RETENTION_BY_TIER: Record<Tier, TenantRetention> = {
  free: { tracesDays: 14, logsDays: 14, metricsDays: 14 },
  pro: { tracesDays: 365, logsDays: 365, metricsDays: 365 },
};

export function resolveRetention(tier: Tier): TenantRetention {
  return RETENTION_BY_TIER[tier];
}
