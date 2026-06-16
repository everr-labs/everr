// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "../client.js";
import { setupTestTelemetry } from "../test-utils.js";
import { browserApiErrorsIntegration } from "./browser-api-errors.js";
import { browserGlobalHandlersIntegration } from "./browser-globals.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let client: Client;
let integration: ReturnType<typeof browserApiErrorsIntegration>;

beforeEach(() => {
  otel = setupTestTelemetry();
  client = new Client({}, "browser", []);
  integration = browserApiErrorsIntegration();
  integration.setup(client);
});

afterEach(async () => {
  integration.teardown?.();
  await otel.dispose();
});

describe("browserApiErrorsIntegration", () => {
  it("captures errors thrown in addEventListener callbacks and marks them", () => {
    const target = new EventTarget();
    const boom = new Error("listener boom");
    target.addEventListener("ping", () => {
      throw boom;
    });

    // The wrapper re-throws; jsdom's handling of that is irrelevant to capture.
    try {
      target.dispatchEvent(new Event("ping"));
    } catch {
      // expected: the wrapper re-throws so app behaviour is unchanged.
    }

    const [record] = otel.records();
    expect(record.attributes["exception.message"]).toBe("listener boom");
    expect(record.attributes["everr.error.mechanism"]).toBe("browserapi");
    expect(record.attributes["everr.error.handled"]).toBe(false);
    // Marked so the window "error" handler skips the duplicate.
    expect(client.wasCaptured(boom)).toBe(true);
  });

  it("removeEventListener unregisters the wrapped listener", () => {
    const target = new EventTarget();
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    target.addEventListener("ping", listener);
    target.removeEventListener("ping", listener);
    target.dispatchEvent(new Event("ping"));
    expect(calls).toBe(0);
  });

  it("does not double-report with the window error handler", () => {
    const globals = browserGlobalHandlersIntegration();
    globals.setup(client);

    const boom = new Error("shared boom");
    const target = new EventTarget();
    target.addEventListener("ping", () => {
      throw boom;
    });
    try {
      target.dispatchEvent(new Event("ping"));
    } catch {
      // browserApiErrors captures + marks, then re-throws.
    }

    // The re-thrown error then reaches the window "error" handler.
    window.dispatchEvent(new ErrorEvent("error", { error: boom, message: "shared boom" }));
    globals.teardown?.();

    expect(otel.records()).toHaveLength(1);
    expect(otel.records()[0].attributes["everr.error.mechanism"]).toBe("browserapi");
  });

  it("teardown restores the patched globals", () => {
    const patchedTimeout = globalThis.setTimeout;
    const patchedAddEventListener = EventTarget.prototype.addEventListener;
    integration.teardown?.();
    expect(globalThis.setTimeout).not.toBe(patchedTimeout);
    expect(EventTarget.prototype.addEventListener).not.toBe(patchedAddEventListener);
  });
});
