import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { Client } from "../client.js";
import { setupTestTelemetry } from "../test-utils.js";
import { nodeGlobalHandlersIntegration } from "./node-globals.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let integration: ReturnType<typeof nodeGlobalHandlersIntegration>;

beforeEach(() => {
  otel = setupTestTelemetry();
  const client = new Client({ onFatal: "continue" }, "node", []);
  integration = nodeGlobalHandlersIntegration();
  integration.setup(client);
});

afterEach(async () => {
  integration.teardown?.();
  await otel.dispose();
});

describe("nodeGlobalHandlersIntegration", () => {
  it("captures uncaughtException as fatal/unhandled", () => {
    process.emit("uncaughtException", new Error("crash"));
    const [record] = otel.records();
    expect(record.eventName).toBe("exception");
    expect(record.attributes["everr.error.mechanism"]).toBe("uncaughtException");
    expect(record.attributes["everr.error.handled"]).toBe(false);
    expect(record.severityText).toBe("FATAL");
  });

  it("captures unhandledRejection including non-Error reasons", () => {
    process.emit("unhandledRejection", "string reason", Promise.resolve());
    const [record] = otel.records();
    expect(record.attributes["everr.error.mechanism"]).toBe("unhandledrejection");
    expect(record.attributes["exception.type"]).toBe("NonError");
  });

  it("teardown removes the listeners", () => {
    const before = process.listenerCount("uncaughtException");
    integration.teardown?.();
    expect(process.listenerCount("uncaughtException")).toBe(before - 1);
    integration = nodeGlobalHandlersIntegration();
    integration.setup(new Client({ onFatal: "continue" }, "node", []));
  });
});
