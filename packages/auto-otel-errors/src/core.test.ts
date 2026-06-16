import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureError, getClient, initClient, teardown } from "./core.js";
import { setupTestTelemetry } from "./test-utils.js";
import type { Integration } from "./types.js";

let otel: ReturnType<typeof setupTestTelemetry>;

beforeEach(() => {
  otel = setupTestTelemetry();
});

afterEach(async () => {
  teardown();
  await otel.dispose();
});

describe("core API", () => {
  it("initClient installs default integrations and getClient returns the client", () => {
    const setup = vi.fn();
    const integration: Integration = { name: "fake", setup };
    const client = initClient({}, "node", [integration]);
    expect(setup).toHaveBeenCalledWith(client);
    expect(getClient()).toBe(client);
  });

  it("user integrations replace the defaults", () => {
    const defaultSetup = vi.fn();
    const userSetup = vi.fn();
    initClient({ integrations: [{ name: "user", setup: userSetup }] }, "node", [
      { name: "default", setup: defaultSetup },
    ]);
    expect(defaultSetup).not.toHaveBeenCalled();
    expect(userSetup).toHaveBeenCalledOnce();
  });

  it("double init returns the existing client", () => {
    const first = initClient({}, "node", []);
    const second = initClient({}, "node", []);
    expect(second).toBe(first);
  });

  it("captureError emits with mechanism manual", () => {
    initClient({}, "node", []);
    captureError(new Error("manual boom"), { feature: "billing" });
    const [record] = otel.records();
    expect(record.eventName).toBe("exception");
    expect(record.attributes["everr.error.mechanism"]).toBe("manual");
    expect(record.attributes.feature).toBe("billing");
  });

  it("captureError is a no-op before init", () => {
    expect(() => captureError(new Error("ignored"))).not.toThrow();
    expect(otel.records()).toHaveLength(0);
  });

  it("teardown tears down integrations and clears the client", () => {
    const down = vi.fn();
    initClient({}, "node", [{ name: "fake", setup: () => {}, teardown: down }]);
    teardown();
    expect(down).toHaveBeenCalledOnce();
    expect(getClient()).toBeNull();
  });
});
