// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retentionForDays } from "#app/product/retention.test-fixtures.ts";

const settings = [
  "EVERR_RETENTION_DAYS",
  "EVERR_RETENTION_TRACES_DAYS",
  "EVERR_RETENTION_LOGS_DAYS",
  "EVERR_RETENTION_METRICS_DAYS",
  "EVERR_RETENTION_ALERT_EVALUATIONS_DAYS",
  "EVERR_RETENTION_ALERT_LIFECYCLE_DAYS",
];
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SKIP_ENV_VALIDATION", "false");
  for (const setting of settings) vi.stubEnv(setting, undefined);
});
afterEach(() => vi.unstubAllEnvs());

async function retention() {
  const { retentionForOrg } = await import("#app/lib/retention.server.ts");
  return retentionForOrg("org");
}

describe("configured retention policy", () => {
  it("defaults every signal to 30 days", async () => {
    expect(await retention()).toEqual(retentionForDays(30));
  });
  it("applies an instance default and independent overrides through the shared lookup", async () => {
    vi.stubEnv("EVERR_RETENTION_DAYS", "90");
    vi.stubEnv("EVERR_RETENTION_TRACES_DAYS", "14");
    vi.stubEnv("EVERR_RETENTION_LOGS_DAYS", "7");
    vi.stubEnv("EVERR_RETENTION_METRICS_DAYS", "180");
    vi.stubEnv("EVERR_RETENTION_ALERT_EVALUATIONS_DAYS", "1");
    vi.stubEnv("EVERR_RETENTION_ALERT_LIFECYCLE_DAYS", "365");
    expect(await retention()).toEqual({
      tracesDays: 14,
      logsDays: 7,
      metricsDays: 180,
      alertEvaluationDays: 1,
      alertLifecycleDays: 365,
    });
  });
  it("uses the instance default for unset or empty overrides", async () => {
    vi.stubEnv("EVERR_RETENTION_DAYS", "90");
    vi.stubEnv("EVERR_RETENTION_LOGS_DAYS", "");
    expect(await retention()).toEqual(retentionForDays(90));
  });
  it("rejects a retention window unsupported by storage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EVERR_RETENTION_DAYS", "31");
    await expect(retention()).rejects.toThrow("Invalid environment variables");
    vi.restoreAllMocks();
  });
});
