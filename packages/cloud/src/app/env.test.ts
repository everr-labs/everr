// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SKIP_ENV_VALIDATION", "false");
  vi.stubEnv("CLICKHOUSE_SQL_API_MASTER_KEY", "x".repeat(32));
  vi.stubEnv("EMAIL_DSN", "smtp://fixture:fixture@localhost");
  vi.stubEnv("EMAIL_FROM", "fixture@example.com");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "fixture");
  vi.stubEnv("POLAR_WEBHOOK_SECRET", "fixture");
  vi.stubEnv("POLAR_PRO_PRODUCT_ID", "fixture");
  vi.stubEnv("CRM_BREVO_MODE", "disabled");
  vi.stubEnv("CRM_BREVO_API_KEY", undefined);
  vi.stubEnv("CRM_BREVO_TIMEOUT_MS", undefined);
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

it.each([undefined, ""])("defaults an absent or empty mode to disabled (%s)", async (mode) => {
  vi.stubEnv("CRM_BREVO_MODE", mode);
  const { appEnv } = await import("./env");
  const { runtime } = await import("./composition/runtime");
  expect(appEnv.CRM_BREVO_MODE).toBe("disabled");
  expect(appEnv.CRM_BREVO_API_KEY).toBeUndefined();
  expect(runtime.events).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([undefined, ""])(
  "normalizes configured settings and defaults timeout %s",
  async (timeout) => {
    vi.stubEnv("CRM_BREVO_MODE", "configured");
    vi.stubEnv("CRM_BREVO_API_KEY", " fixture-secret ");
    vi.stubEnv("CRM_BREVO_TIMEOUT_MS", timeout);
    const { appEnv } = await import("./env");
    const { runtime } = await import("./composition/runtime");
    expect(appEnv.CRM_BREVO_API_KEY).toBe("fixture-secret");
    expect(appEnv.CRM_BREVO_TIMEOUT_MS).toBe(10_000);
    expect(runtime.events).toHaveLength(12);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each(["100", "30000"])("accepts request timeout boundary %s as a number", async (timeout) => {
  vi.stubEnv("CRM_BREVO_MODE", "configured");
  vi.stubEnv("CRM_BREVO_API_KEY", "fixture-secret");
  vi.stubEnv("CRM_BREVO_TIMEOUT_MS", timeout);
  const { appEnv } = await import("./env");
  expect(appEnv.CRM_BREVO_TIMEOUT_MS).toBe(Number(timeout));
});

it.each([undefined, "", "   "])("requires a nonempty key in configured mode (%s)", async (key) => {
  vi.stubEnv("CRM_BREVO_MODE", "configured");
  vi.stubEnv("CRM_BREVO_API_KEY", key);
  await expect(import("./env")).rejects.toThrow(
    /^Invalid Cloud environment configuration: CRM_BREVO_API_KEY\.$/,
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});

it.each(["paused", "unknown"])("rejects unsupported mode %s", async (mode) => {
  vi.stubEnv("CRM_BREVO_MODE", mode);
  await expect(import("./env")).rejects.toThrow(
    /^Invalid Cloud environment configuration: CRM_BREVO_MODE\.$/,
  );
});

it.each(["99", "30001", "1.5", "invalid", "Infinity"])(
  "rejects invalid timeout %s without logging credentials or validation inputs",
  async (timeout) => {
    vi.stubEnv("CRM_BREVO_MODE", "configured");
    vi.stubEnv("CRM_BREVO_API_KEY", "fixture-secret");
    vi.stubEnv("CRM_BREVO_TIMEOUT_MS", timeout);
    await expect(import("./env")).rejects.toThrow(
      /^Invalid Cloud environment configuration: CRM_BREVO_TIMEOUT_MS\.$/,
    );
    expect(console.error).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("keeps build configuration disabled when validation and runtime secrets are absent", async () => {
  vi.stubEnv("SKIP_ENV_VALIDATION", "true");
  vi.stubEnv("CRM_BREVO_MODE", undefined);
  for (const name of [
    "CLICKHOUSE_SQL_API_MASTER_KEY",
    "EMAIL_DSN",
    "EMAIL_FROM",
    "POLAR_ACCESS_TOKEN",
    "POLAR_WEBHOOK_SECRET",
    "POLAR_PRO_PRODUCT_ID",
  ])
    vi.stubEnv(name, undefined);
  const { runtime } = await import("./composition/runtime");
  expect(runtime.events).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
