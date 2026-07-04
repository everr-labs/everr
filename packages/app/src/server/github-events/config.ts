export const GH_EVENTS_CONFIG = {
  maxAttempts: 10,
  // The collector ingests a run's log archive synchronously before returning
  // 202; large runs legitimately take ~30s, so give them headroom instead of
  // aborting and retrying the whole download.
  replayTimeoutMs: 60_000,
  tenantCacheTTLms: 60_000,
  retentionDoneDays: 7,
  retentionDeadDays: 30,
} as const;
