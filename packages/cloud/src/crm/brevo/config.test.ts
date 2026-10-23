// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";

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
  vi.stubEnv("CRM_BREVO_DEPLOYMENT", undefined);
  vi.stubEnv("CRM_BREVO_ACCOUNT_SCOPE", undefined);
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
  const quota = { acquire: vi.fn(), cooldown: vi.fn() };
  const adapter = createBrevoAdapter(readBrevoConfig(appEnv), quota);
  expect(await adapter.deleteCompany("fixture")).toMatchObject({ ok: false, kind: "disabled" });
  expect(transport).not.toHaveBeenCalled();
  expect(quota.acquire).not.toHaveBeenCalled();
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
  vi.stubEnv("CRM_BREVO_DEPLOYMENT", "test");
  vi.stubEnv("CRM_BREVO_ACCOUNT_SCOPE", "test-account");
  const { appEnv } = await import("../../app/env");
  expect(appEnv.CRM_BREVO_MODE).toBe("paused");
  expect(transport).not.toHaveBeenCalled();
});
