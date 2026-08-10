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
    configure({ redactPatterns: [/tok_\w+/g], rateLimit: false });
    // This call sets only the redaction. The rate limit stays off. Thus the
    // client sends all the twenty reports.
    configure({ redactPatterns: [/key_\w+/g] });
    for (let i = 0; i < 20; i++) captureError(new Error("same"));
    expect(otel.records()).toHaveLength(20);
    expect(otel.records()[0]?.body).toBe("Error: same");
  });

  it("replaces a present key wholesale rather than merging into it", () => {
    configure({ redactPatterns: [/tok_\w+/g] });
    configure({ redactPatterns: [/key_\w+/g] });
    captureError(new Error("tok_abc and key_def"));
    // The second array replaces the first pattern. The client does not add the
    // two arrays together.
    expect(otel.records()[0]?.body).toBe("Error: tok_abc and [Filtered]");
  });

  it("treats an explicitly passed undefined as absent", () => {
    const error = new Error("same");
    configure({
      beforeSend: () => null,
      rateLimit: { count: 2, windowMs: 60_000 },
    });
    // This is an example of a caller that forwards an optional configuration.
    // The two fields have no value. Thus the client changes neither of them:
    // the hook stays installed, and the rate limiter keeps its windows.
    configure({ beforeSend: undefined, rateLimit: undefined });
    captureError(error);
    expect(otel.records()).toHaveLength(0);

    configure({ beforeSend: null });
    captureError(error);
    captureError(error);
    // The client sends one record, not two. The rate limit operates before
    // beforeSend. Thus the capture above that the client discarded used one of
    // the two allowances. A new window lets the two records through.
    expect(otel.records()).toHaveLength(1);
  });

  it("takes the last writer without warning", () => {
    const warn = vi.spyOn(diag, "warn").mockImplementation(() => {});
    configure({ redactKeys: false });
    configure({ redactKeys: true });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("clears beforeSend when passed null, and only then", () => {
    configure({ beforeSend: () => null });
    captureError(new Error("dropped"));
    expect(otel.records()).toHaveLength(0);

    // A key that is not present must not remove the hook.
    configure({ redactKeys: true });
    captureError(new Error("still dropped"));
    expect(otel.records()).toHaveLength(0);

    configure({ beforeSend: null });
    captureError(new Error("kept"));
    expect(otel.records()).toHaveLength(1);
  });

  // All these tests use one error object. The rate limiter makes a fingerprint
  // from the type, the message, and the top frame. Thus each error object that
  // the code constructs has its own allowance, and the rate limit does not
  // operate.
  it("keeps the rate-limit window when the limit itself is not re-stated", () => {
    const error = new Error("same");
    configure({ rateLimit: { count: 2, windowMs: 60_000 } });
    captureError(error);
    captureError(error);
    // The client sent two records, and the window is full. A call to
    // configure() that does not contain rateLimit must not give a new
    // allowance.
    configure({ redactKeys: true });
    captureError(error);
    expect(otel.records()).toHaveLength(2);
  });

  it("restarts the rate-limit window when the limit is re-stated", () => {
    const error = new Error("same");
    configure({ rateLimit: { count: 2, windowMs: 60_000 } });
    captureError(error);
    captureError(error);
    configure({ rateLimit: { count: 2, windowMs: 60_000 } });
    captureError(error);
    expect(otel.records()).toHaveLength(3);
  });
});

describe("capture", () => {
  it("reports through the same configured client as captureError", () => {
    configure({ redactPatterns: [/tok_\w+/g] });
    capture({ error: new Error("tok_abc"), mechanism: "react" });
    const [record] = otel.records();
    expect(record?.attributes["everr.error.mechanism"]).toBe("react");
    expect(record?.body).toBe("Error: [Filtered]");
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
