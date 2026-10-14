import type { WebSDKOptions } from "@everr/otel-web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localSqlClient } from "@/features/logs/local-sql-client";
import {
  captureLocalSqlError,
  initializeTelemetry,
} from "./internal-telemetry";

const mocks = vi.hoisted(() => ({
  sdk: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@everr/otel-web", () => ({
  WebSDK: class {
    constructor(options: WebSDKOptions) {
      mocks.sdk(options);
    }
  },
  captureError: mocks.capture,
  errors: () => "errors",
  interactions: () => "interactions",
  performance: () => "performance",
}));

beforeEach(() => {
  vi.clearAllMocks();
  initializeTelemetry({
    serviceVersion: "test",
    telemetryEnabled: false,
    deploymentEnvironment: "production",
  });
});

describe("internal UI telemetry", () => {
  it("does not initialize an exporter when the backend disables telemetry", () => {
    expect(mocks.sdk).not.toHaveBeenCalled();
  });

  it.each([
    "development",
    "production",
  ] as const)("uses the backend's %s build mode", async (deploymentEnvironment) => {
    initializeTelemetry({
      serviceVersion: "cli-build-version",
      telemetryEnabled: true,
      deploymentEnvironment,
    });
    const options = mocks.sdk.mock.calls[0][0] as WebSDKOptions;
    expect(options).toMatchObject({
      serviceName: "everr-local-ui",
      serviceVersion: "cli-build-version",
      deploymentEnvironment,
    });
    expect(options).not.toHaveProperty("ingestKey");
    expect(options).not.toHaveProperty("endpoint");
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await options.send?.("logs", '{"resourceLogs":[]}');
    expect(fetch).toHaveBeenCalledWith("/api/telemetry/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Everr-Local": "1" },
      body: '{"resourceLogs":[]}',
    });
  });

  it("exports a fixed SQL error while preserving the detailed error for the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "SELECT 'customer-sentinel' failed" }),
      }),
    );
    await expect(
      localSqlClient.execute("SELECT 'customer-sentinel'", {}),
    ).rejects.toThrow("customer-sentinel");
    expect(mocks.capture).toHaveBeenCalledOnce();
    const [error, attributes] = mocks.capture.mock.calls[0];
    expect(error.message).toBe("Local telemetry query failed");
    expect(error.stack).not.toContain("customer-sentinel");
    expect(attributes).toEqual({ "everr.error.source": "local-ui.local_sql" });
  });

  it("keeps detailed SQL errors in debug builds", () => {
    initializeTelemetry({
      serviceVersion: "test",
      telemetryEnabled: true,
      deploymentEnvironment: "development",
    });
    const error = new Error("debug query details");
    captureLocalSqlError(error);
    expect(mocks.capture.mock.calls[0][0]).toBe(error);
  });

  it("removes customer filters from record and resource URLs before cloud export", async () => {
    initializeTelemetry({
      serviceVersion: "test",
      telemetryEnabled: true,
      deploymentEnvironment: "production",
    });
    const options = mocks.sdk.mock.calls[0][0] as WebSDKOptions;
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const attribute = (key: string) => ({
      key,
      value: {
        stringValue:
          "http://127.0.0.1/logs?q=customer-sentinel#customer-sentinel",
      },
    });
    const body = JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: [attribute("everr.landing.url")] },
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [
                    attribute("url.full"),
                    attribute("everr.referrer.url"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    await options.send?.("logs", body);
    const sent = fetch.mock.calls[0][1].body as string;
    expect(sent).not.toContain("customer-sentinel");
    expect(sent).toContain("http://127.0.0.1/logs");
  });
});
