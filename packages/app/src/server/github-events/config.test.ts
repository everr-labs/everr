// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

function stubGitHubEventsEnv(overrides: Partial<Record<string, string>> = {}) {
  const values = {
    INGRESS_SOURCE: "github",
    INGRESS_COLLECTOR_URL: "http://localhost:8080/webhook/github",
    INGRESS_WORKER_COUNT: "2",
    INGRESS_WORKER_BATCH_SIZE: "10",
    INGRESS_MAX_ATTEMPTS: "10",
    INGRESS_POLL_INTERVAL: "2000ms",
    INGRESS_LOCK_DURATION: "120000ms",
    INGRESS_REPLAY_TIMEOUT: "30000ms",
    INGRESS_TENANT_CACHE_TTL: "60000ms",
    INGRESS_RETENTION_DONE_DAYS: "7",
    INGRESS_RETENTION_DEAD_DAYS: "30",
    INGRESS_CLEANUP_INTERVAL: "3600000ms",
    CDEVENTS_CLICKHOUSE_URL: "http://localhost:8123",
    CDEVENTS_CLICKHOUSE_USERNAME: "app_cdevents_rw",
    CDEVENTS_CLICKHOUSE_PASSWORD: "app-cdevents-dev",
    CDEVENTS_CLICKHOUSE_DATABASE: "app",
    CDEVENTS_BATCH_SIZE: "100",
    CDEVENTS_FLUSH_INTERVAL: "5000ms",
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("getGitHubEventsConfig", () => {
  it("requires every GitHub events variable to be set", async () => {
    stubGitHubEventsEnv({
      INGRESS_SOURCE: "   ",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(import("./config")).rejects.toThrow();

    consoleError.mockRestore();
  });

  it("parses explicit overrides through t3 env", async () => {
    stubGitHubEventsEnv({
      INGRESS_SOURCE: "github-enterprise",
      INGRESS_COLLECTOR_URL: "https://collector.example.com/hook",
      INGRESS_WORKER_COUNT: "4",
      INGRESS_WORKER_BATCH_SIZE: "25",
      INGRESS_MAX_ATTEMPTS: "12",
      INGRESS_POLL_INTERVAL: "3s",
      INGRESS_LOCK_DURATION: "5m",
      INGRESS_REPLAY_TIMEOUT: "45s",
      INGRESS_TENANT_CACHE_TTL: "2m",
      INGRESS_RETENTION_DONE_DAYS: "14",
      INGRESS_RETENTION_DEAD_DAYS: "60",
      INGRESS_CLEANUP_INTERVAL: "2h",
      CDEVENTS_CLICKHOUSE_URL: "https://clickhouse.example.com",
      CDEVENTS_CLICKHOUSE_USERNAME: "writer",
      CDEVENTS_CLICKHOUSE_PASSWORD: "secret-value",
      CDEVENTS_CLICKHOUSE_DATABASE: "analytics",
      CDEVENTS_BATCH_SIZE: "250",
      CDEVENTS_FLUSH_INTERVAL: "750ms",
    });

    const { getGitHubEventsConfig } = await import("./config");
    expect(getGitHubEventsConfig()).toMatchObject({
      source: "github-enterprise",
      collectorURL: "https://collector.example.com/hook",
      workerCount: 4,
      workerBatchSize: 25,
      maxAttempts: 12,
      pollIntervalMs: 3_000,
      lockDurationMs: 300_000,
      replayTimeoutMs: 45_000,
      tenantCacheTTLms: 120_000,
      retentionDoneDays: 14,
      retentionDeadDays: 60,
      cleanupIntervalMs: 7_200_000,
      cdeventsClickHouseURL: "https://clickhouse.example.com",
      cdeventsClickHouseUsername: "writer",
      cdeventsClickHousePassword: "secret-value",
      cdeventsClickHouseDatabase: "analytics",
      cdeventsBatchSize: 250,
      cdeventsFlushIntervalMs: 750,
    });
  });

  it("rejects invalid duration values", async () => {
    stubGitHubEventsEnv({
      INGRESS_POLL_INTERVAL: "5",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(import("./config")).rejects.toThrow();

    consoleError.mockRestore();
  });
});
