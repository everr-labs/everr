export type Tier = "free" | "pro";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

// The only retention values that exist. retentionForOrg (retention.server.ts)
// hands them to the collector, which stamps them on every resource, and the
// app.* tables partition by (day, retention_days). A table holds one live
// partition per day per distinct value in its column below: 14 + 365 = 379 for
// every table. A new tier or a new value adds its days to that budget; keep it
// under about 1,000 per table.
const RETENTION_BY_TIER: Record<Tier, TenantRetention> = {
  free: { tracesDays: 14, logsDays: 14, metricsDays: 14 },
  // One window per tier across all three signals. A single value per tier is
  // what keeps the partition budget flat: a signal with its own number adds
  // that many more daily partitions to its table.
  pro: { tracesDays: 365, logsDays: 365, metricsDays: 365 },
};

export function resolveRetention(tier: Tier): TenantRetention {
  return RETENTION_BY_TIER[tier];
}
