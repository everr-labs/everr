export const GH_EVENTS_CONFIG = {
  workerCount: 2,
  workerBatchSize: 10,
  maxAttempts: 10,
  pollIntervalMs: 2_000,
  lockDurationMs: 120_000,
  replayTimeoutMs: 30_000,
  tenantCacheTTLms: 60_000,
  retentionDoneDays: 7,
  retentionDeadDays: 30,
  cleanupIntervalMs: 3_600_000,
} as const;
