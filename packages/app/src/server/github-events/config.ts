export const GH_EVENTS_CONFIG = {
  workerCount: 2,
  maxAttempts: 10,
  replayTimeoutMs: 30_000,
  tenantCacheTTLms: 60_000,
  retentionDoneDays: 7,
  retentionDeadDays: 30,
} as const;
