// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
import { readBrevoConfig } from "./config";

function cloudEnv() {
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
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("loads cloud configuration and constructs the disabled adapter without provider I/O", async () => {
  vi.resetModules();
  cloudEnv();
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  const { appEnv } = await import("../../app/env");
  const { createBrevoAdapter } = await import("./adapter");
  const { readBrevoConfig } = await import("./config");
  const adapter = createBrevoAdapter(readBrevoConfig(appEnv));
  expect(await adapter.deleteCompany("fixture")).toMatchObject({ ok: false, kind: "disabled" });
  expect(transport).not.toHaveBeenCalled();
});

it("rejects incomplete enabled cloud startup and validates complete paused startup without provider calls", async () => {
  vi.resetModules();
  cloudEnv();
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  vi.stubEnv("CRM_BREVO_MODE", "configured");
  await expect(import("../../app/env")).rejects.toThrow("Invalid Brevo CRM configuration.");
  vi.resetModules();
  vi.stubEnv("CRM_BREVO_MODE", "paused");
  vi.stubEnv("CRM_BREVO_API_KEY", "fixture-secret");
  const { appEnv } = await import("../../app/env");
  expect(appEnv.CRM_BREVO_MODE).toBe("paused");
  expect(transport).not.toHaveBeenCalled();
});

it.each([undefined, ""])("defaults an absent or empty mode to disabled (%s)", async (mode) => {
  vi.resetModules();
  cloudEnv();
  vi.stubEnv("CRM_BREVO_MODE", mode);
  const { appEnv } = await import("../../app/env");
  const { runtime } = await import("../../app/composition/runtime");
  expect(appEnv.CRM_BREVO_MODE).toBe("disabled");
  expect(readBrevoConfig(appEnv)).toEqual({ mode: "disabled" });
  expect(readBrevoConfig({ CRM_BREVO_MODE: mode })).toEqual({ mode: "disabled" });
  expect(runtime.events).toEqual([]);
});

it.each(["configured", "paused"])(
  "uses the same default timeout for empty Cloud and script settings in %s mode",
  async (mode) => {
    vi.resetModules();
    cloudEnv();
    vi.stubEnv("CRM_BREVO_MODE", mode);
    vi.stubEnv("CRM_BREVO_API_KEY", " fixture-secret ");
    vi.stubEnv("CRM_BREVO_TIMEOUT_MS", "");
    const { appEnv } = await import("../../app/env");
    const { runtime } = await import("../../app/composition/runtime");
    const expected = { mode, apiKey: "fixture-secret", timeoutMs: 10_000 };
    expect(readBrevoConfig(appEnv)).toEqual(expected);
    expect(readBrevoConfig(process.env)).toEqual(expected);
    expect(runtime.events).toHaveLength(12);
  },
);

it.each(["99", "30001", "1.5", "invalid"])(
  "rejects invalid timeout %s without exposing the API key",
  async (timeout) => {
    vi.resetModules();
    cloudEnv();
    vi.stubEnv("CRM_BREVO_MODE", "configured");
    vi.stubEnv("CRM_BREVO_API_KEY", "fixture-secret");
    vi.stubEnv("CRM_BREVO_TIMEOUT_MS", timeout);
    await expect(import("../../app/env")).rejects.toThrow(/^Invalid Brevo CRM configuration\.$/);
  },
);

it("keeps build configuration disabled when validation and runtime secrets are absent", async () => {
  vi.resetModules();
  vi.stubEnv("SKIP_ENV_VALIDATION", "true");
  vi.stubEnv("CRM_BREVO_MODE", undefined);
  vi.stubEnv("CRM_BREVO_API_KEY", undefined);
  const { runtime } = await import("../../app/composition/runtime");
  expect(runtime.events).toEqual([]);
});
