// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import * as browserEntry from "./browser.js";
import * as nodeEntry from "./node.js";
import { setupTestTelemetry } from "./test-utils.js";

afterEach(() => {
  browserEntry.teardown();
  nodeEntry.teardown();
});

describe("entry points", () => {
  it("node entry exposes the public API and default integrations", () => {
    expect(nodeEntry.init).toBeTypeOf("function");
    expect(nodeEntry.captureError).toBeTypeOf("function");
    expect(nodeEntry.teardown).toBeTypeOf("function");
    expect(
      nodeEntry.nodeDefaultIntegrations().map((integration) => integration.name),
    ).toEqual(["nodeGlobalHandlers"]);
  });

  it("browser entry exposes browser default integrations", () => {
    expect(
      browserEntry
        .browserDefaultIntegrations()
        .map((integration) => integration.name),
    ).toEqual(["browserGlobalHandlers", "browserApiErrors"]);
  });

  it("browser init installs default capture handlers", async () => {
    const otel = setupTestTelemetry();
    try {
      browserEntry.init();
      window.dispatchEvent(
        new ErrorEvent("error", {
          error: new Error("entry boom"),
          message: "entry boom",
        }),
      );

      const [record] = otel.records();
      expect(record.attributes["everr.error.mechanism"]).toBe("onerror");
      expect(record.attributes["exception.message"]).toBe("entry boom");
    } finally {
      await otel.dispose();
    }
  });

  it("node init installs and teardown uninstalls cleanly", () => {
    const client = nodeEntry.init({ onFatal: "continue" });
    expect(client.runtime).toBe("node");
    expect(() => nodeEntry.teardown()).not.toThrow();
  });
});
