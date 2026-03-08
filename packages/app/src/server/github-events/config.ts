import { githubEventsEnv } from "../../github-events.env";

export type GitHubEventsConfig = {
  source: string;
  collectorURL: string;
  workerCount: number;
  workerBatchSize: number;
  maxAttempts: number;
  pollIntervalMs: number;
  lockDurationMs: number;
  replayTimeoutMs: number;
  tenantCacheTTLms: number;
  retentionDoneDays: number;
  retentionDeadDays: number;
  cleanupIntervalMs: number;
  cdeventsClickHouseURL: string;
  cdeventsClickHouseUsername: string;
  cdeventsClickHousePassword: string;
  cdeventsClickHouseDatabase: string;
  cdeventsBatchSize: number;
  cdeventsFlushIntervalMs: number;
};

let cachedConfig: GitHubEventsConfig | undefined;

export function getGitHubEventsConfig(): GitHubEventsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    source: githubEventsEnv.INGRESS_SOURCE,
    collectorURL: githubEventsEnv.INGRESS_COLLECTOR_URL,
    workerCount: githubEventsEnv.INGRESS_WORKER_COUNT,
    workerBatchSize: githubEventsEnv.INGRESS_WORKER_BATCH_SIZE,
    maxAttempts: githubEventsEnv.INGRESS_MAX_ATTEMPTS,
    pollIntervalMs: githubEventsEnv.INGRESS_POLL_INTERVAL,
    lockDurationMs: githubEventsEnv.INGRESS_LOCK_DURATION,
    replayTimeoutMs: githubEventsEnv.INGRESS_REPLAY_TIMEOUT,
    tenantCacheTTLms: githubEventsEnv.INGRESS_TENANT_CACHE_TTL,
    retentionDoneDays: githubEventsEnv.INGRESS_RETENTION_DONE_DAYS,
    retentionDeadDays: githubEventsEnv.INGRESS_RETENTION_DEAD_DAYS,
    cleanupIntervalMs: githubEventsEnv.INGRESS_CLEANUP_INTERVAL,
    cdeventsClickHouseURL: githubEventsEnv.CDEVENTS_CLICKHOUSE_URL,
    cdeventsClickHouseUsername: githubEventsEnv.CDEVENTS_CLICKHOUSE_USERNAME,
    cdeventsClickHousePassword: githubEventsEnv.CDEVENTS_CLICKHOUSE_PASSWORD,
    cdeventsClickHouseDatabase: githubEventsEnv.CDEVENTS_CLICKHOUSE_DATABASE,
    cdeventsBatchSize: githubEventsEnv.CDEVENTS_BATCH_SIZE,
    cdeventsFlushIntervalMs: githubEventsEnv.CDEVENTS_FLUSH_INTERVAL,
  };

  return cachedConfig;
}
