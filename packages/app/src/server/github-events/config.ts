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

const githubEventsConfigConstants = {
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
  cdeventsBatchSize: 100,
  cdeventsFlushIntervalMs: 5_000,
} satisfies Pick<
  GitHubEventsConfig,
  | "workerCount"
  | "workerBatchSize"
  | "maxAttempts"
  | "pollIntervalMs"
  | "lockDurationMs"
  | "replayTimeoutMs"
  | "tenantCacheTTLms"
  | "retentionDoneDays"
  | "retentionDeadDays"
  | "cleanupIntervalMs"
  | "cdeventsBatchSize"
  | "cdeventsFlushIntervalMs"
>;

let cachedConfig: GitHubEventsConfig | undefined;

export function getGitHubEventsConfig(): GitHubEventsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    source: githubEventsEnv.INGRESS_SOURCE,
    collectorURL: githubEventsEnv.INGRESS_COLLECTOR_URL,
    ...githubEventsConfigConstants,
    cdeventsClickHouseURL: githubEventsEnv.CDEVENTS_CLICKHOUSE_URL,
    cdeventsClickHouseUsername: githubEventsEnv.CDEVENTS_CLICKHOUSE_USERNAME,
    cdeventsClickHousePassword: githubEventsEnv.CDEVENTS_CLICKHOUSE_PASSWORD,
    cdeventsClickHouseDatabase: githubEventsEnv.CDEVENTS_CLICKHOUSE_DATABASE,
  };

  return cachedConfig;
}
