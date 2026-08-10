import { diag } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  capture,
  captureError,
  configure,
  resetSharedClient,
} from "./capture.js";
import { setupTestTelemetry } from "./test-utils.js";

// The singleton layer: one client for the whole process, configured through
// `configure` alone. What each test asserts is the merge contract (an absent
// key keeps the current value, a present one replaces it wholesale), not the
// capture path itself, which client.test.ts covers against its own instances.

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
    // Only redaction is re-stated: the disabled rate limit must survive, so
    // all twenty reports land.
    configure({ redactPatterns: [/key_\w+/g] });
    for (let i = 0; i < 20; i++) captureError(new Error("same"));
    expect(otel.records()).toHaveLength(20);
    expect(otel.records()[0]?.body).toBe("Error: same");
  });

  it("replaces a present key wholesale rather than merging into it", () => {
    configure({ redactPatterns: [/tok_\w+/g] });
    configure({ redactPatterns: [/key_\w+/g] });
    captureError(new Error("tok_abc and key_def"));
    // The first pattern is gone, not unioned with the second.
    expect(otel.records()[0]?.body).toBe("Error: tok_abc and [Filtered]");
  });

  it("treats an explicitly passed undefined as absent", () => {
    const error = new Error("same");
    configure({
      beforeSend: () => null,
      rateLimit: { count: 2, windowMs: 60_000 },
    });
    // What forwarding an optional config looks like. Neither field is set, so
    // neither may take effect: the hook stays installed and the limiter keeps
    // its windows.
    configure({ beforeSend: undefined, rateLimit: undefined });
    captureError(error);
    expect(otel.records()).toHaveLength(0);

    configure({ beforeSend: null });
    captureError(error);
    captureError(error);
    // One record, not two: the throttle runs before beforeSend, so the
    // dropped capture above already spent one of the two. A restarted window
    // would have let both of these through.
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

    // An absent key must not clear the hook.
    configure({ redactKeys: true });
    captureError(new Error("still dropped"));
    expect(otel.records()).toHaveLength(0);

    configure({ beforeSend: null });
    captureError(new Error("kept"));
    expect(otel.records()).toHaveLength(1);
  });

  // One error object throughout: the limiter fingerprints on type, message,
  // and top frame, so separately constructed errors would each get their own
  // budget and never throttle.
  it("keeps the rate-limit window when the limit itself is not re-stated", () => {
    const error = new Error("same");
    configure({ rateLimit: { count: 2, windowMs: 60_000 } });
    captureError(error);
    captureError(error);
    // Two are through, the window is full. A configure() that says nothing
    // about rateLimit must not hand out a fresh budget.
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
