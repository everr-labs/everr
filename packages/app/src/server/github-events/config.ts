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
>;

let cachedConfig: GitHubEventsConfig | undefined;

function resolveCollectorURL(rawURL: string): string {
  const url = new URL(rawURL);

  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/hook";
  }

  return url.toString();
}

export function getGitHubEventsConfig(): GitHubEventsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    source: githubEventsEnv.INGRESS_SOURCE,
    collectorURL: resolveCollectorURL(githubEventsEnv.INGRESS_COLLECTOR_URL),
    ...githubEventsConfigConstants,
  };

  return cachedConfig;
}
