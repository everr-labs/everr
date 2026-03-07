import { githubEventSource } from "./types";

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

const durationUnits = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

function readString(name: string, fallback?: string): string {
  const raw = process.env[name]?.trim();
  if (raw) {
    return raw;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`${name} is required`);
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function readDuration(name: string, fallbackMs: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallbackMs;
  }

  const match = raw.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`${name} must use one of: ms, s, m, h, d`);
  }

  const amount = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2] as keyof typeof durationUnits;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${name} must be a positive duration`);
  }

  return amount * durationUnits[unit];
}

let cachedConfig: GitHubEventsConfig | undefined;

export function getGitHubEventsConfig(): GitHubEventsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    source: readString("INGRESS_SOURCE", githubEventSource),
    collectorURL: readString(
      "INGRESS_COLLECTOR_URL",
      "http://localhost:8080/webhook/github",
    ),
    workerCount: readPositiveInteger("INGRESS_WORKER_COUNT", 2),
    workerBatchSize: readPositiveInteger("INGRESS_WORKER_BATCH_SIZE", 10),
    maxAttempts: readPositiveInteger("INGRESS_MAX_ATTEMPTS", 10),
    pollIntervalMs: readDuration("INGRESS_POLL_INTERVAL", 2_000),
    lockDurationMs: readDuration("INGRESS_LOCK_DURATION", 120_000),
    replayTimeoutMs: readDuration("INGRESS_REPLAY_TIMEOUT", 30_000),
    tenantCacheTTLms: readDuration("INGRESS_TENANT_CACHE_TTL", 60_000),
    retentionDoneDays: readPositiveInteger("INGRESS_RETENTION_DONE_DAYS", 7),
    retentionDeadDays: readPositiveInteger("INGRESS_RETENTION_DEAD_DAYS", 30),
    cleanupIntervalMs: readDuration("INGRESS_CLEANUP_INTERVAL", 3_600_000),
    cdeventsClickHouseURL: readString(
      "CDEVENTS_CLICKHOUSE_URL",
      "http://localhost:8123",
    ),
    cdeventsClickHouseUsername: readString(
      "CDEVENTS_CLICKHOUSE_USERNAME",
      "app_cdevents_rw",
    ),
    cdeventsClickHousePassword: readString(
      "CDEVENTS_CLICKHOUSE_PASSWORD",
      "app-cdevents-dev",
    ),
    cdeventsClickHouseDatabase: readString(
      "CDEVENTS_CLICKHOUSE_DATABASE",
      "app",
    ),
    cdeventsBatchSize: readPositiveInteger("CDEVENTS_BATCH_SIZE", 100),
    cdeventsFlushIntervalMs: readDuration("CDEVENTS_FLUSH_INTERVAL", 5_000),
  };

  return cachedConfig;
}
