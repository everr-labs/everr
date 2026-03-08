// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

function stubGitHubEventsEnv(overrides: Partial<Record<string, string>> = {}) {
  const values = {
    INGRESS_SOURCE: "github",
    INGRESS_COLLECTOR_URL: "http://localhost:8080/webhook/github",
    CDEVENTS_CLICKHOUSE_URL: "http://localhost:8123",
    CDEVENTS_CLICKHOUSE_USERNAME: "app_cdevents_rw",
    CDEVENTS_CLICKHOUSE_PASSWORD: "app-cdevents-dev",
    CDEVENTS_CLICKHOUSE_DATABASE: "app",
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
      CDEVENTS_CLICKHOUSE_URL: "https://clickhouse.example.com",
      CDEVENTS_CLICKHOUSE_USERNAME: "writer",
      CDEVENTS_CLICKHOUSE_PASSWORD: "secret-value",
      CDEVENTS_CLICKHOUSE_DATABASE: "analytics",
    });

    const { getGitHubEventsConfig } = await import("./config");
    expect(getGitHubEventsConfig()).toMatchObject({
      source: "github-enterprise",
      collectorURL: "https://collector.example.com/hook",
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
      cdeventsClickHouseURL: "https://clickhouse.example.com",
      cdeventsClickHouseUsername: "writer",
      cdeventsClickHousePassword: "secret-value",
      cdeventsClickHouseDatabase: "analytics",
      cdeventsBatchSize: 100,
      cdeventsFlushIntervalMs: 5_000,
    });
  });

  it("rejects invalid collector URLs", async () => {
    stubGitHubEventsEnv({
      INGRESS_COLLECTOR_URL: "not-a-url",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(import("./config")).rejects.toThrow();

    consoleError.mockRestore();
  });
});
