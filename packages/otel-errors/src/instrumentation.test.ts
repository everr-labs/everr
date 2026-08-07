import { diag } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureError, resetSharedClient } from "./capture.js";
import { ErrorsInstrumentation } from "./instrumentation.js";
import { setupTestTelemetry } from "./test-utils.js";
import { PKG_NAME } from "./version.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let instrumentation: ErrorsInstrumentation | null = null;

function enable(
  config: ConstructorParameters<typeof ErrorsInstrumentation>[0] = {},
) {
  instrumentation = new ErrorsInstrumentation({
    onFatal: "continue",
    ...config,
  });
  return instrumentation;
}

beforeEach(() => {
  otel = setupTestTelemetry();
});

afterEach(async () => {
  instrumentation?.disable();
  instrumentation = null;
  resetSharedClient();
  await otel.dispose();
});

describe("ErrorsInstrumentation lifecycle", () => {
  it("carries the package name and version as its scope", () => {
    const it_ = enable();
    expect(it_.instrumentationName).toBe(PKG_NAME);
    expect(it_.instrumentationVersion).toBeTypeOf("string");
  });

  it("installs the process listeners on construction", () => {
    const before = process.listenerCount("uncaughtException");
    enable();
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
    expect(process.listenerCount("unhandledRejection")).toBeGreaterThan(0);
  });

  it("does not install when constructed with enabled: false", () => {
    const before = process.listenerCount("uncaughtException");
    enable({ enabled: false });
    expect(process.listenerCount("uncaughtException")).toBe(before);
    expect(otel.records()).toHaveLength(0);
  });

  it("reports enabled through getConfig so registerInstrumentations does not double-install", () => {
    const it_ = enable();
    const after = process.listenerCount("uncaughtException");
    expect(it_.getConfig().enabled).toBe(true);
    it_.enable();
    expect(process.listenerCount("uncaughtException")).toBe(after);
  });

  it("disable removes the listeners but captureError keeps working", () => {
    const before = process.listenerCount("uncaughtException");
    const it_ = enable();
    it_.disable();
    expect(process.listenerCount("uncaughtException")).toBe(before);

    captureError(new Error("still reported"));
    expect(otel.records()).toHaveLength(1);
  });

  it("disabling a replaced instrumentation leaves the live one's captureError working", () => {
    const first = enable();
    const warn = vi.spyOn(diag, "warn").mockImplementation(() => {});
    const second = new ErrorsInstrumentation({ onFatal: "continue" });
    try {
      expect(warn).toHaveBeenCalledOnce();
      first.disable();
      captureError(new Error("still reported"));
      expect(otel.records()).toHaveLength(1);
    } finally {
      warn.mockRestore();
      second.disable();
    }
  });

  it("setConfig reinstalls with the new options", () => {
    const it_ = enable();
    it_.setConfig({ onFatal: "continue", beforeSend: () => null });
    process.emit("uncaughtException", new Error("suppressed"));
    expect(otel.records()).toHaveLength(0);
    expect(it_.getConfig().onFatal).toBe("continue");
  });
});

describe("standalone captureError", () => {
  it("emits through the global logger provider with no instrumentation", () => {
    captureError(new Error("standalone"), { feature: "billing" });
    const [record] = otel.records();
    expect(record.eventName).toBe("exception");
    expect(record.attributes["everr.error.mechanism"]).toBe("manual");
    expect(record.attributes.feature).toBe("billing");
  });

  it("warns once when no LoggerProvider is registered", async () => {
    await otel.dispose();
    resetSharedClient();

    const warn = vi.spyOn(diag, "warn").mockImplementation(() => {});
    captureError(new Error("lost"));
    captureError(new Error("also lost"));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    otel = setupTestTelemetry();
  });

  it("applies instrumentation options to manual captures", () => {
    enable({ beforeSend: () => null });
    captureError(new Error("suppressed"));
    expect(otel.records()).toHaveLength(0);
  });

  it("keeps instrumentation options after disable", () => {
    const it_ = enable({ beforeSend: () => null });
    it_.disable();
    captureError(new Error("still suppressed"));
    expect(otel.records()).toHaveLength(0);
  });
});

describe("ErrorsInstrumentation capture", () => {
  it("captures uncaughtException as fatal and unhandled", () => {
    enable();
    process.emit("uncaughtException", new Error("crash"));
    const [record] = otel.records();
    expect(record.eventName).toBe("exception");
    expect(record.attributes["everr.error.mechanism"]).toBe(
      "uncaughtException",
    );
    expect(record.attributes["everr.error.handled"]).toBe(false);
    expect(record.severityText).toBe("FATAL");
  });

  it("captures unhandledRejection including non-Error reasons", () => {
    enable();
    process.emit("unhandledRejection", "string reason", Promise.resolve());
    const [record] = otel.records();
    expect(record.attributes["everr.error.mechanism"]).toBe(
      "unhandledrejection",
    );
    expect(record.attributes["exception.type"]).toBe("NonError");
  });

  it("backs captureError with mechanism manual", () => {
    enable();
    captureError(new Error("manual boom"), { feature: "billing" });
    const [record] = otel.records();
    expect(record.attributes["everr.error.mechanism"]).toBe("manual");
    expect(record.attributes["everr.error.handled"]).toBe(true);
    expect(record.attributes.feature).toBe("billing");
  });

  it("captureError reads handled from the error.handled attribute", () => {
    enable();
    captureError(new Error("boom"), { "error.handled": false });
    const [record] = otel.records();
    expect(record.attributes["everr.error.handled"]).toBe(false);
  });

  it("captureError options win over the attribute", () => {
    enable();
    captureError(
      new Error("boom"),
      { "error.handled": false },
      { handled: true },
    );
    const [record] = otel.records();
    expect(record.attributes["everr.error.handled"]).toBe(true);
  });

  it("emits through an SDK-injected LoggerProvider instead of the global", () => {
    const it_ = enable();
    const emit = vi.fn();
    it_.setLoggerProvider({
      getLogger: () => ({ emit }),
    } as unknown as Parameters<ErrorsInstrumentation["setLoggerProvider"]>[0]);

    process.emit("uncaughtException", new Error("routed"));
    expect(otel.records()).toHaveLength(0);
    expect(emit).toHaveBeenCalledOnce();
  });
});
