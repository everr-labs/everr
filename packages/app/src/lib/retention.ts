export type Tier = "free" | "pro";

export type TenantRetention = {
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
};

// The only retention values that exist. retentionForOrg (retention.server.ts)
// hands them to the collector, which stamps them on every resource, and the
// app.* tables partition by (retention_days, bucket). The bucket follows the
// value (clickhouse/init/10-create-mvs.sql): 90 days or less is one partition
// per day, so the window ends on time; more is one partition per month, so a
// row can outlive its window by up to 31 days and a year reads from 13 parts.
// Live partitions per table: 14 daily + 13 monthly, about 27. A new value adds
// its days when 90 or less and its months when more; keep the total under
// about 1,000 per table.
const RETENTION_BY_TIER: Record<Tier, TenantRetention> = {
  free: { tracesDays: 14, logsDays: 14, metricsDays: 14 },
  // One window per tier across all three signals. A single value per tier is
  // what keeps the partition budget flat: a signal with its own number adds
  // its own partitions to its table.
  pro: { tracesDays: 365, logsDays: 365, metricsDays: 365 },
};

export function resolveRetention(tier: Tier): TenantRetention {
  return RETENTION_BY_TIER[tier];
}
