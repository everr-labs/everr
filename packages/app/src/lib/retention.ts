export type Tier = "free" | "pro";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

// The app.* tables partition by (day, retention_days), so every distinct
// retention value keeps that many live partitions per table (a 90-day value
// holds 90 daily partitions). upsertTenantRetention rejects values outside
// this set to keep the partition count bounded; extend it consciously.
export const ALLOWED_RETENTION_DAYS: readonly number[] = [
  7, 14, 30, 90, 365, 395,
];

const RETENTION_BY_TIER: Record<Tier, TenantRetention> = {
  free: { tracesDays: 7, logsDays: 7, metricsDays: 14 },
  // Metrics retention is "13 months" — Datadog/industry convention, stored
  // here as 395 days (~13 × 30.4).
  pro: { tracesDays: 90, logsDays: 90, metricsDays: 395 },
};

export function resolveRetention(tier: Tier): TenantRetention {
  return RETENTION_BY_TIER[tier];
}
