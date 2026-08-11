import { diag } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  capture,
  captureError,
  configure,
  resetSharedClient,
} from "./capture.js";
import { setupTestTelemetry } from "./test-utils.js";

// Tests for the singleton layer. The full process has one client, and only
// `configure` sets it. Each test examines the rules of the merge: a key that is
// not present keeps the current value, and a key that is present replaces the
// full field. These tests do not examine the capture path. The tests in
// client.test.ts examine that path with their own instances.

let otel: ReturnType<typeof setupTestTelemetry>;

beforeEach(() => {
  otel = setupTestTelemetry();
});

afterEach(async () => {
  resetSharedClient();
  await otel.dispose();
});

describe("configure", () => {
  it("leaves untouched keys at their current value", () => {
    configure({
      beforeSend: (event) => ({ ...event, message: "from the first call" }),
    });
    // This call sets no key at all. Thus beforeSend stays installed.
    configure({});
    captureError(new Error("same"));
    expect(otel.records()[0]?.body).toBe("from the first call");
  });

  it("replaces a present key wholesale rather than merging into it", () => {
    configure({ beforeSend: (event) => ({ ...event, message: "first" }) });
    configure({ beforeSend: (event) => ({ ...event, message: "second" }) });
    captureError(new Error("same"));
    // The second hook replaces the first one. The client does not call the two
    // hooks in sequence.
    expect(otel.records()).toHaveLength(1);
    expect(otel.records()[0]?.body).toBe("second");
  });

  it("treats an explicitly passed undefined as absent", () => {
    configure({ beforeSend: () => null });
    // This is an example of a caller that forwards an optional configuration.
    // The field has no value. Thus the client does not remove the hook.
    configure({ beforeSend: undefined });
    captureError(new Error("same"));
    expect(otel.records()).toHaveLength(0);
  });

  it("takes the last writer without warning", () => {
    const warn = vi.spyOn(diag, "warn").mockImplementation(() => {});
    configure({ beforeSend: () => null });
    configure({ beforeSend: (event) => event });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("clears beforeSend when passed null, and only then", () => {
    configure({ beforeSend: () => null });
    captureError(new Error("dropped"));
    expect(otel.records()).toHaveLength(0);

    // A call with no key must not remove the hook.
    configure({});
    captureError(new Error("still dropped"));
    expect(otel.records()).toHaveLength(0);

    configure({ beforeSend: null });
    captureError(new Error("kept"));
    expect(otel.records()).toHaveLength(1);
  });
});

describe("capture", () => {
  it("reports through the same configured client as captureError", () => {
    configure({
      beforeSend: (event) => ({ ...event, message: "changed by the hook" }),
    });
    capture({ error: new Error("tok_abc"), mechanism: "react" });
    const [record] = otel.records();
    expect(record?.attributes["everr.error.mechanism"]).toBe("react");
    expect(record?.body).toBe("changed by the hook");
  });
});

describe("captureError", () => {
  it("works with no configure() call at all", () => {
    captureError(new Error("boom"), { "order.id": "o_1" });
    const [record] = otel.records();
    expect(record?.attributes["everr.error.mechanism"]).toBe("manual");
    expect(record?.attributes["order.id"]).toBe("o_1");
  });
});
