export type Tier = "free" | "pro";

// Dictionary key of the free-tier row the ClickHouse views fall back to for
// tenants without a row of their own (see clickhouse/init/10-create-mvs.sql).
export const DEFAULT_RETENTION_TENANT_ID = "";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

// These are the only retention values that reach ClickHouse:
// upsertTenantRetention takes a tier, not days. That matters because the
// app.* tables partition by (day, retention_days), so a table holds one live
// partition per day per distinct value in its column below: 14 + 30 = 44 for
// logs and traces, 14 + 395 = 409 for each metrics table. A new tier or a new
// value adds its days to that budget; keep it under about 1,000 per table.
const RETENTION_BY_TIER: Record<Tier, TenantRetention> = {
  free: { tracesDays: 14, logsDays: 14, metricsDays: 14 },
  // Metrics retention is "13 months", the Datadog and industry convention,
  // stored here as 395 days (about 13 x 30.4).
  pro: { tracesDays: 30, logsDays: 30, metricsDays: 395 },
};

export function resolveRetention(tier: Tier): TenantRetention {
  return RETENTION_BY_TIER[tier];
}
