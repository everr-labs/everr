// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "../client.js";
import { setupTestTelemetry } from "../test-utils.js";
import { browserGlobalHandlersIntegration } from "./browser-globals.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let client: Client;
let integration: ReturnType<typeof browserGlobalHandlersIntegration>;

beforeEach(() => {
  otel = setupTestTelemetry();
  client = new Client({}, "browser", []);
  integration = browserGlobalHandlersIntegration();
  integration.setup(client);
});

afterEach(async () => {
  integration.teardown?.();
  await otel.dispose();
});

describe("browserGlobalHandlersIntegration", () => {
  it("captures window error events that carry an Error", () => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("render boom"),
        message: "render boom",
      }),
    );
    const [record] = otel.records();
    expect(record.eventName).toBe("exception");
    expect(record.attributes["everr.error.mechanism"]).toBe("onerror");
    expect(record.attributes["exception.type"]).toBe("TypeError");
    expect(record.attributes["everr.error.handled"]).toBe(false);
  });

  it("ignores error events without an error object (resource load errors)", () => {
    window.dispatchEvent(new ErrorEvent("error", { message: "img failed" }));
    expect(otel.records()).toHaveLength(0);
  });

  it("captures unhandled promise rejections", () => {
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new Error("rejected");
    window.dispatchEvent(event);
    const [record] = otel.records();
    expect(record.attributes["everr.error.mechanism"]).toBe("unhandledrejection");
  });

  it("ignores unhandled rejection reasons already captured by browserApiErrors", () => {
    const reason = new Error("already captured");
    client.markCaptured(reason);

    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = reason;
    window.dispatchEvent(event);

    expect(otel.records()).toHaveLength(0);
  });

  it("teardown removes listeners", () => {
    integration.teardown?.();
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new Error("after");
    window.dispatchEvent(event);
    expect(otel.records()).toHaveLength(0);
  });
});
