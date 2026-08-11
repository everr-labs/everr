import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSDK } from "./client.js";
import { captureError } from "./index.js";
import { captureReactError } from "./react.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
  UNIQUE_ID,
} from "./test-kit.js";

let client: WebSDK | undefined;
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
    expect(a["everr.error.mechanism"]).toBe("onerror");
    // The analytics envelope connects the error to the other signals of the
    // session.
    expect(a["session.id"]).toMatch(UNIQUE_ID);
    expect(a["everr.page_view.id"]).toMatch(UNIQUE_ID);
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
    expect(String(a["everr.react.component_stack"])).toContain("Broken");
    expect(a["session.id"]).toMatch(UNIQUE_ID);
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
    // The test stops the event. Thus the window listener of vitest does not
    // report this error, which the test does not capture on purpose.
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

  it("captures errors via captureError with context attributes", async () => {
    start();
    captureError(new Error("db write failed"), {
      "everr.feature": "billing",
      "everr.attempt": 2,
    });
    const record = (await records()).find((r) => r.eventName === "exception");
    const a = attrs(record as OtlpRecord);
    expect(a["everr.error.mechanism"]).toBe("manual");
    expect(a["everr.feature"]).toBe("billing");
    expect(a["everr.attempt"]).toBe("2");
  });

  it("ships message and stack verbatim (no scrubbing, by decision)", async () => {
    // The SDK removes nothing from the content of an error. The application
    // owns that policy, in the beforeSend hook of the WebSDK.
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
    // One unhandled rejection usually causes the two events. Only the first
    // event must make a record.
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
    // The module data here is the data after a shutdown, because the earlier
    // tests constructed the SDK. A shutdown is an intentional operation. Thus
    // the functions do nothing and give no warning about the configuration.
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
    // A new instance of the module gives the true condition before a
    // construction. The react entry uses that same condition through the
    // dynamic report binding.
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

describe("normalization edge shapes", () => {
  afterEach(async () => {
    await client?.shutdown();
    client = undefined;
  });

  it("stringifies non-Error values, with String() for the unjsonable", async () => {
    start();
    captureError(undefined); // JSON.stringify(undefined) is undefined
    const record = (await records()).find((r) => r.eventName === "exception");
    const a = attrs(record as OtlpRecord);
    expect(a["exception.type"]).toBe("NonError");
    expect(a["exception.message"]).toBe("undefined");
  });

  it("marks circular values unserializable instead of throwing", async () => {
    start();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    captureError(circular);
    const record = (await records()).find((r) => r.eventName === "exception");
    expect(attrs(record as OtlpRecord)["exception.message"]).toBe(
      "[unserializable]",
    );
  });

  it("falls back to Error for a nameless error and keeps the bare type as body", async () => {
    start();
    const nameless = new Error(""); // empty message too
    nameless.name = "";
    delete nameless.stack; // stack falls back to "name: message"
    captureError(nameless);
    const record = (await records()).find((r) => r.eventName === "exception");
    expect(record?.body).toEqual({ stringValue: "Error" });
    const a = attrs(record as OtlpRecord);
    expect(a["exception.type"]).toBe("Error");
    expect(a["exception.stacktrace"]).toBe(": ");
  });

  it("prunes the rate-limit window once it tracks over 1000 distinct errors", async () => {
    vi.useFakeTimers();
    try {
      start();
      captureError(new Error("prune-seed"));
      vi.advanceTimersByTime(6_000); // the seed's window goes stale
      // At more than 1000 keys, the code removes the old keys at the next
      // report.
      for (let i = 0; i < 1_001; i++) captureError(new Error(`prune-${i}`));
      // The code removed the first key. Thus its window accepts five new
      // reports again.
      for (let i = 0; i < 5; i++) captureError(new Error("prune-seed"));
    } finally {
      vi.useRealTimers();
    }
    const seeds = (await records()).filter(
      (r) =>
        r.eventName === "exception" &&
        attrs(r)["exception.message"] === "prune-seed",
    );
    expect(seeds).toHaveLength(6);
  });
});

describe("cross-handler dedup, remaining orders", () => {
  it("does not re-report from a rejection after onerror saw the same object", async () => {
    start();
    const error = new TypeError("seen by onerror first");
    window.dispatchEvent(
      new ErrorEvent("error", { error, message: error.message }),
    );
    const event = new Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    event.reason = error;
    window.dispatchEvent(event);
    const all = await records();
    expect(all.filter((r) => r.eventName === "exception")).toHaveLength(1);
  });

  it("reports primitive rejection reasons, which dedup cannot track", async () => {
    start();
    const event = new Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    event.reason = "primitive-reason";
    window.dispatchEvent(event);
    const record = (await records()).find(
      (r) =>
        r.eventName === "exception" &&
        attrs(r)["exception.message"] === "primitive-reason",
    );
    expect(attrs(record as OtlpRecord)["exception.type"]).toBe("NonError");
  });
});

describe("rate-limit window boundary", () => {
  it("frees a slot at exactly five seconds, not before", async () => {
    vi.useFakeTimers();
    try {
      start();
      // The rate limiter makes its key from the type, the message, and the top
      // frame. The test sets the stack. Thus each report uses one key, and the
      // line of the caller does not change that key.
      const edgeError = () => {
        const error = new Error("window-edge");
        error.stack = "Error: window-edge\n    at edge (https://app/x.js:1:1)";
        return error;
      };
      for (let i = 0; i < 5; i++) captureError(edgeError());
      captureError(edgeError()); // 6th in-window: dropped
      vi.advanceTimersByTime(4_999);
      captureError(edgeError()); // still in-window: dropped
      vi.advanceTimersByTime(1); // the first five stamps expire exactly now
      captureError(edgeError());
    } finally {
      vi.useRealTimers();
    }
    const edge = (await records()).filter(
      (r) =>
        r.eventName === "exception" &&
        attrs(r)["exception.message"] === "window-edge",
    );
    expect(edge).toHaveLength(6);
  });
});
