export type Tier = "free" | "pro";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

// The only retention values that exist. retentionForOrg (retention.server.ts)
// hands them to the collector, which stamps them on every resource, and the
// app.* tables partition by (day, retention_days). A table holds one live
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
