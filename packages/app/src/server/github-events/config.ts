export const GH_EVENTS_CONFIG = {
  maxAttempts: 10,
  // Keep in step with the collector server's WriteTimeout: responses can't
  // take longer than that anyway, and with the log archive size cap the
  // collector answers well within it.
  replayTimeoutMs: 30_000,
  tenantCacheTTLms: 60_000,
  retentionDoneDays: 7,
  retentionDeadDays: 30,
} as const;
