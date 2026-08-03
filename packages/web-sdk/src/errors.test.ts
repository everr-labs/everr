import { afterEach, describe, expect, it, vi } from "vitest";
import { captureError } from "./index.js";
import { captureReactError } from "./react.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
} from "./test-kit.js";
import type { EverrClient } from "./types.js";

let client: EverrClient | undefined;
let batches: OtlpBatch[];

function start(): void {
  [client, batches] = startClient();
}

async function records(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches.flatMap((b) => b.records);
}

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
  vi.unstubAllGlobals();
});

describe("error capture through the SDK", () => {
  it("captures window errors as enveloped exception records with error severity", async () => {
    start();
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("render boom"),
        message: "render boom",
      }),
    );
    const record = (await records()).find((r) => r.eventName === "exception");
    expect(record).toBeDefined();
    expect(record?.severityNumber).toBe(17);
    expect(record?.body).toEqual({ stringValue: "TypeError: render boom" });
    const a = attrs(record as OtlpRecord);
    expect(a["exception.type"]).toBe("TypeError");
    expect(a["exception.message"]).toBe("render boom");
    expect(String(a["exception.stacktrace"])).toContain("TypeError");
    expect(a["everr.error.handled"]).toBe(false);
    expect(a["everr.error.mechanism"]).toBe("onerror");
    // The analytics envelope joins the error to the session's other signals.
    expect(a["session.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(a["everr.page_view.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(a["url.path"]).toBe("/");
  });

  it("captures unhandled promise rejections", async () => {
    start();
    const event = new Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    event.reason = new Error("rejected");
    window.dispatchEvent(event);
    const record = (await records()).find((r) => r.eventName === "exception");
    const a = attrs(record as OtlpRecord);
    expect(a["everr.error.mechanism"]).toBe("unhandledrejection");
    expect(a["exception.message"]).toBe("rejected");
  });

  it("captures React render errors via the re-exported captureReactError", async () => {
    start();
    captureReactError(new Error("component boom"), {
      componentStack: "\n    at Broken\n    at App",
    });
    const record = (await records()).find((r) => r.eventName === "exception");
    const a = attrs(record as OtlpRecord);
    expect(a["everr.error.mechanism"]).toBe("react");
    expect(a["everr.error.handled"]).toBe(true);
    expect(String(a["everr.react.component_stack"])).toContain("Broken");
    expect(a["session.id"]).toMatch(/[0-9a-f-]{36}/);
  });

  it("ships the captured error on the exit flush", async () => {
    start();
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("exit boom"),
        message: "exit boom",
      }),
    );
    dispatchEvent(new Event("pagehide"));
    const exitBatch = batches.find((b) => b.keepalive);
    expect(exitBatch).toBeDefined();
    expect(exitBatch?.records.map((r) => r.eventName)).toContain("exception");
  });

  it("stops capturing after shutdown", async () => {
    start();
    await client?.shutdown();
    // Swallow the event so vitest's own window listener does not report the
    // deliberately-uncaptured error as an unhandled exception.
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener("error", swallow);
    try {
      window.dispatchEvent(
        new ErrorEvent("error", {
          error: new Error("late boom"),
          message: "late boom",
          cancelable: true,
        }),
      );
    } finally {
      window.removeEventListener("error", swallow);
    }
    const all = await records();
    expect(all.filter((r) => r.eventName === "exception")).toHaveLength(0);
  });

  it("captures handled errors via captureError with extra attributes", async () => {
    start();
    captureError(new Error("db write failed"), {
      "everr.feature": "billing",
      "everr.attempt": 2,
    });
    const record = (await records()).find((r) => r.eventName === "exception");
    const a = attrs(record as OtlpRecord);
    expect(a["everr.error.mechanism"]).toBe("manual");
    expect(a["everr.error.handled"]).toBe(true);
    expect(a["everr.feature"]).toBe("billing");
    expect(a["everr.attempt"]).toBe("2");
  });

  it("ships message and stack verbatim (no scrubbing, by decision)", async () => {
    // Decided 2026-07-27 under the bundle budget: error content is not
    // scrubbed. Scrubbing must return before errors are exposed to external
    // consented-mode adopters (ticket 09).
    start();
    const error = new Error("login failed for a@b.com");
    error.stack = "Error: login failed for a@b.com\n    at auth (/cb:1:1)";
    window.dispatchEvent(
      new ErrorEvent("error", { error, message: "login failed" }),
    );
    const record = (await records()).find((r) => r.eventName === "exception");
    expect(record?.body).toEqual({
      stringValue: "Error: login failed for a@b.com",
    });
    const a = attrs(record as OtlpRecord);
    expect(a["exception.message"]).toBe("login failed for a@b.com");
    expect(String(a["exception.stacktrace"])).toContain("at auth (/cb:1:1)");
  });

  it("rate-limits identical errors to five per window", async () => {
    start();
    const error = new Error("same boom");
    for (let i = 0; i < 10; i++) {
      window.dispatchEvent(new ErrorEvent("error", { error, message: "x" }));
    }
    const all = await records();
    expect(all.filter((r) => r.eventName === "exception")).toHaveLength(5);
  });

  it("does not double-report the same error from both onerror and unhandledrejection", async () => {
    start();
    const error = new TypeError("Failed to fetch");
    // A single unhandled rejection typically fires both events; only the
    // first should produce a record.
    const event = new Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    event.reason = error;
    window.dispatchEvent(event);
    window.dispatchEvent(
      new ErrorEvent("error", { error, message: "Failed to fetch" }),
    );
    const all = await records();
    expect(all.filter((r) => r.eventName === "exception")).toHaveLength(1);
  });

  it("captures non-Error rejection reasons as NonError", async () => {
    start();
    const event = new Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    event.reason = { code: 42 };
    window.dispatchEvent(event);
    const record = (await records()).find((r) => r.eventName === "exception");
    const a = attrs(record as OtlpRecord);
    expect(a["exception.type"]).toBe("NonError");
    expect(a["exception.message"]).toBe('{"code":42}');
  });

  it("stays silent after shutdown instead of warning", () => {
    // Module state here is post-shutdown (earlier tests initialized the SDK):
    // deliberate teardown means silent no-ops, not misconfiguration warnings.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => captureReactError(new Error("late"))).not.toThrow();
      expect(() => captureError(new Error("late"))).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns instead of throwing when captured before init", async () => {
    // A fresh module instance is the real before-init state; the react entry
    // shares it through the live report binding.
    vi.resetModules();
    const fresh = await import("./errors.js");
    const freshReact = await import("./react.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => fresh.captureError(new Error("early"))).not.toThrow();
      expect(() =>
        freshReact.captureReactError(new Error("early")),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith("[everr] SDK not initialized");
    } finally {
      warn.mockRestore();
    }
  });
});
