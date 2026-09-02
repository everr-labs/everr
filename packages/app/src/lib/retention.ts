export type Tier = "free" | "pro";

// Dictionary key of the free-tier row the ClickHouse views fall back to for
// tenants without a row of their own (see clickhouse/init/10-create-mvs.sql).
export const DEFAULT_RETENTION_TENANT_ID = "";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

// The app.* tables partition by (day, retention_days), so every distinct
// retention value keeps that many live partitions per table (a 30-day value
// holds 30 daily partitions). upsertTenantRetention rejects values outside
// this set to keep the partition count bounded; extend it consciously. The
// set is exactly the values RETENTION_BY_TIER uses.
export const ALLOWED_RETENTION_DAYS: readonly number[] = [14, 30, 395];

const RETENTION_BY_TIER: Record<Tier, TenantRetention> = {
  free: { tracesDays: 14, logsDays: 14, metricsDays: 14 },
  // Metrics retention is "13 months", the Datadog and industry convention,
  // stored here as 395 days (about 13 x 30.4).
  pro: { tracesDays: 30, logsDays: 30, metricsDays: 395 },
};

export function resolveRetention(tier: Tier): TenantRetention {
  return RETENTION_BY_TIER[tier];
}
