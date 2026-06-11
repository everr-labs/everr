// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "../client.js";
import { setupTestTelemetry } from "../test-utils.js";
import { browserGlobalHandlersIntegration } from "./browser-globals.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let integration: ReturnType<typeof browserGlobalHandlersIntegration>;

beforeEach(() => {
  otel = setupTestTelemetry();
  integration = browserGlobalHandlersIntegration();
  integration.setup(new Client({}, "browser", []));
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
    expect(record.attributes["exception.mechanism"]).toBe("onerror");
    expect(record.attributes["exception.type"]).toBe("TypeError");
    expect(record.attributes["exception.handled"]).toBe(false);
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
    expect(record.attributes["exception.mechanism"]).toBe("unhandledrejection");
  });

  it("teardown removes listeners", () => {
    integration.teardown?.();
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new Error("after");
    window.dispatchEvent(event);
    expect(otel.records()).toHaveLength(0);
  });
});
