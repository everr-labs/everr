import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "../client.js";
import { setupTestTelemetry } from "../test-utils.js";
import type { Options } from "../types.js";
import { consoleIntegration } from "./console.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let integration: ReturnType<typeof consoleIntegration>;

beforeEach(() => {
  otel = setupTestTelemetry();
});

afterEach(async () => {
  integration?.teardown?.();
  await otel.dispose();
});

function setup(options: Options = {}) {
  const client = new Client(options, "node", []);
  integration = consoleIntegration();
  integration.setup(client);
  return client;
}

describe("consoleIntegration", () => {
  it("captures console.error with an Error argument", () => {
    setup();
    console.error("request failed:", new Error("boom"));
    const [record] = otel.records();
    expect(record.attributes["exception.mechanism"]).toBe("console");
    expect(record.attributes["exception.type"]).toBe("Error");
    expect(record.body).toContain("request failed:");
  });

  it("synthesizes an error for message-only console.error", () => {
    setup();
    console.error("plain failure", { code: 7 });
    const [record] = otel.records();
    expect(record.attributes["exception.type"]).toBe("ConsoleError");
    expect(record.body).toBe('plain failure {"code":7}');
  });

  it("does not capture console.warn by default but does when configured", () => {
    setup();
    console.warn("just a warning");
    expect(otel.records()).toHaveLength(0);
    integration.teardown?.();

    setup({ console: { levels: ["error", "warn"] } });
    console.warn("captured warning");
    expect(otel.records()).toHaveLength(1);
  });

  it("records breadcrumbs for all console levels", () => {
    const client = setup();
    console.info("step one");
    console.error(new Error("boom"));
    expect(client.breadcrumbs?.all().map((c) => c.category)).toEqual([
      "console",
      "console",
    ]);
    expect(client.breadcrumbs?.all()[0].message).toBe("step one");
  });

  it("does not loop when the emit path itself logs", () => {
    const client = setup({
      beforeSend: (event) => {
        console.error("logging during processing");
        return event;
      },
    });
    console.error(new Error("trigger"));
    expect(otel.records()).toHaveLength(1);
    expect(client.breadcrumbs).not.toBeNull();
  });

  it("teardown restores the original console methods", () => {
    const originalError = console.error;
    setup();
    expect(console.error).not.toBe(originalError);
    integration.teardown?.();
    expect(console.error).toBe(originalError);
  });
});
