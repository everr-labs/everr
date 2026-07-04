export const GH_EVENTS_CONFIG = {
  maxAttempts: 10,
  // The collector acks the webhook once the run is queued for ingestion, so
  // replays are normally fast; the headroom covers a busy collector without
  // aborting and retrying the whole delivery.
  replayTimeoutMs: 60_000,
  tenantCacheTTLms: 60_000,
  retentionDoneDays: 7,
  retentionDeadDays: 30,
} as const;
