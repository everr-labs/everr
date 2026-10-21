import type { WebSDKOptions } from "@everr/otel-web";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { localSqlClient } from "@/features/logs/local-sql-client";
import { captureLocalSqlError, initializeTelemetry } from "./internal-telemetry";

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
    undefined,
    null,
    {},
    { serviceVersion: "test", telemetryEnabled: "true", deploymentEnvironment: "production" },
    { serviceVersion: "test", telemetryEnabled: true, deploymentEnvironment: "unknown" },
    { serviceVersion: 1, telemetryEnabled: true, deploymentEnvironment: "production" },
  ])("rejects malformed backend settings before starting telemetry: %j", (context) => {
    expect(() => initializeTelemetry(context)).toThrow();
    expect(mocks.sdk).not.toHaveBeenCalled();
  });

  it("restores production error redaction if backend settings become invalid", () => {
    initializeTelemetry({
      serviceVersion: "test",
      telemetryEnabled: true,
      deploymentEnvironment: "development",
    });
    expect(() => initializeTelemetry({})).toThrow();
    captureLocalSqlError(new Error("customer-sentinel"));
    expect(mocks.sdk).toHaveBeenCalledOnce();
    expect(mocks.capture.mock.calls[0][0].message).toBe("Local telemetry query failed");
    expect(mocks.capture.mock.calls[0][0].stack).not.toContain("customer-sentinel");
  });

  it.each(["not-json", '{"resourceLogs":', '{"value":1e999}'])(
    "does not export invalid JSON: %s",
    async (body) => {
      initializeTelemetry({
        serviceVersion: "test",
        telemetryEnabled: true,
        deploymentEnvironment: "production",
      });
      const options = mocks.sdk.mock.calls[0][0] as WebSDKOptions;
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(options.send?.("logs", body)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("preserves nested OTLP values and unknown fields while redacting private attributes", async () => {
    initializeTelemetry({
      serviceVersion: "test",
      telemetryEnabled: true,
      deploymentEnvironment: "production",
    });
    const options = mocks.sdk.mock.calls[0][0] as WebSDKOptions;
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const safeValues = [
      null,
      false,
      0,
      "",
      { boolValue: true },
      { intValue: "9007199254740993" },
      { doubleValue: 1.25 },
      { bytesValue: "AQID" },
      { key: "url.full", value: null },
      { key: "url.full", value: { intValue: "42" } },
    ];
    const privateAttribute = {
      key: "everr.utm.future",
      value: { stringValue: "customer-sentinel" },
    };
    const urlAttribute = {
      key: "url.full",
      value: { stringValue: "/logs?q=customer-sentinel#private", futureValue: { boolValue: true } },
      futureField: [null, false, 42],
    };
    const payload = (values: unknown[]) => ({
      resourceLogs: [
        {
          futureField: { array: safeValues },
          scopeLogs: [{ logRecords: [{ body: { kvlistValue: { values } } }] }],
        },
      ],
    });
    await options.send?.(
      "logs",
      JSON.stringify(
        payload([
          {
            key: "nested",
            value: { arrayValue: { values: [privateAttribute, urlAttribute, ...safeValues] } },
          },
        ]),
      ),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(
      payload([
        {
          key: "nested",
          value: {
            arrayValue: {
              values: [
                { ...urlAttribute, value: { ...urlAttribute.value, stringValue: "/logs" } },
                ...safeValues,
              ],
            },
          },
        },
      ]),
    );
  });

  it.each(["development", "production"] as const)(
    "uses the backend's %s build mode",
    async (deploymentEnvironment) => {
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
    },
  );

  it("exports a fixed SQL error while preserving the detailed error for the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "SELECT 'customer-sentinel' failed" }),
      }),
    );
    await expect(localSqlClient.execute("SELECT 'customer-sentinel'", {})).rejects.toThrow(
      "customer-sentinel",
    );
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
        stringValue: "http://127.0.0.1/logs?q=customer-sentinel#customer-sentinel",
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
                    attribute("everr.element.href"),
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

  it.each(["logs", "traces"] as const)(
    "removes customer-backed selectors from release %s while preserving interaction metadata",
    async (signal) => {
      initializeTelemetry({
        serviceVersion: "test",
        telemetryEnabled: true,
        deploymentEnvironment: "production",
      });
      const options = mocks.sdk.mock.calls[0][0] as WebSDKOptions;
      const fetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetch);
      const attributes = [
        {
          key: "everr.element.selector",
          value: {
            stringValue: 'button[aria-label="Select customer-span-sentinel"]',
          },
        },
        {
          key: "everr.browser.web_vital.lcp.target",
          value: { stringValue: 'div[title="customer-span-sentinel"]' },
        },
        {
          key: "everr.browser.web_vital.cls.largest_shift_target",
          value: { stringValue: "#customer-span-sentinel" },
        },
        {
          key: "everr.element.href",
          value: {
            stringValue: "/traces/trace-id?q=customer-filter-sentinel#customer-filter-sentinel",
          },
        },
        { key: "everr.element.tag", value: { stringValue: "button" } },
        { key: "everr.browser.click.x", value: { intValue: "42" } },
      ];
      const record = { attributes };
      const body = JSON.stringify(
        signal === "logs"
          ? { resourceLogs: [{ scopeLogs: [{ logRecords: [record] }] }] }
          : { resourceSpans: [{ scopeSpans: [{ spans: [record] }] }] },
      );
      await options.send?.(signal, body);
      const sent = fetch.mock.calls[0][1].body as string;
      expect(sent).not.toContain("customer-span-sentinel");
      expect(sent).not.toContain("customer-filter-sentinel");
      const parsed = JSON.parse(sent);
      const exportedRecord =
        signal === "logs"
          ? parsed.resourceLogs[0].scopeLogs[0].logRecords[0]
          : parsed.resourceSpans[0].scopeSpans[0].spans[0];
      expect(exportedRecord.attributes).toEqual([
        { key: "everr.element.href", value: { stringValue: "/traces/trace-id" } },
        { key: "everr.element.tag", value: { stringValue: "button" } },
        { key: "everr.browser.click.x", value: { intValue: "42" } },
      ]);
    },
  );

  it.each(["logs", "traces"] as const)(
    "drops UTM attribution from release %s at every attribute level and retains it in debug",
    async (signal) => {
      const safeAttributes = [{ key: "service.name", value: { stringValue: "everr-local-ui" } }];
      const attributes = [
        ...safeAttributes,
        ...["source", "medium", "campaign", "term", "content", "future"].map((name) => ({
          key: `everr.utm.${name}`,
          value: { stringValue: `customer-sentinel-${name}` },
        })),
      ];
      const payload = (attrs: typeof attributes) => {
        const resource = { attributes: attrs };
        if (signal === "logs") {
          return {
            resourceLogs: [{ resource, scopeLogs: [{ logRecords: [{ attributes: attrs }] }] }],
          };
        }
        return {
          resourceSpans: [
            {
              resource,
              scopeSpans: [
                {
                  spans: [
                    {
                      attributes: attrs,
                      events: [{ name: "test", attributes: attrs }],
                    },
                  ],
                },
              ],
            },
          ],
        };
      };
      for (const deploymentEnvironment of ["production", "development"] as const) {
        mocks.sdk.mockClear();
        initializeTelemetry({
          serviceVersion: "test",
          telemetryEnabled: true,
          deploymentEnvironment,
        });
        const options = mocks.sdk.mock.calls[0][0] as WebSDKOptions;
        const fetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetch);
        await options.send?.(signal, JSON.stringify(payload(attributes)));
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(
          payload(deploymentEnvironment === "production" ? safeAttributes : attributes),
        );
      }
    },
  );

  it("retains local interaction diagnostics in development builds", async () => {
    initializeTelemetry({
      serviceVersion: "test",
      telemetryEnabled: true,
      deploymentEnvironment: "development",
    });
    const options = mocks.sdk.mock.calls[0][0] as WebSDKOptions;
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const body = JSON.stringify({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [
                    {
                      key: "everr.element.selector",
                      value: {
                        stringValue: 'button[aria-label="Select debug-span"]',
                      },
                    },
                    {
                      key: "everr.element.href",
                      value: {
                        stringValue: "/traces?q=debug-filter#debug-span",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    await options.send?.("logs", body);
    expect(fetch.mock.calls[0][1].body).toBe(body);
  });
});
