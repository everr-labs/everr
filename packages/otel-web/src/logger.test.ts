import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitter } from "./emitter.js";
import { logger, startLogger } from "./logger.js";

type SentRecord = {
  timeUnixNano: string;
  severityNumber: number;
  eventName: string;
  body: { stringValue: string };
  attributes: Array<{ key: string; value: object }>;
};

let sent: SentRecord[];
let flush: () => Promise<void>;
let stop: () => void;

function wire(envelope: () => Record<string, string> = () => ({})) {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      sent.push(...payload.resourceLogs[0].scopeLogs[0].logRecords);
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  const [emit, doFlush] = createEmitter(
    "https://ingest.example/v1/logs",
    "https://ingest.example/v1/traces",
    undefined,
    {},
    { name: "@everr/otel-web", version: "test" },
    envelope,
  );
  flush = doFlush;
  stop = startLogger(emit);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stop?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("logger", () => {
  // Must run before any startLogger in this file: the pre-init sink is
  // module-level state that wiring permanently replaces.
  it("warns instead of throwing before init", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => logger.info("too early")).not.toThrow();
      expect(warn).toHaveBeenCalledWith("[everr] SDK not initialized");
    } finally {
      warn.mockRestore();
    }
  });

  it("emits a plain log record: no event name, message body, level severity", async () => {
    wire(() => ({ "session.id": "s1" }));
    logger.info("checkout started", { "cart.size": 3 });
    await flush();

    const record = sent[0];
    expect(record.eventName).toBe("");
    expect(record.body).toEqual({ stringValue: "checkout started" });
    expect(record.severityNumber).toBe(9);
    expect(record.attributes).toContainEqual({
      key: "cart.size",
      value: { intValue: "3" },
    });
    // Custom logs carry the analytics envelope like every other signal.
    expect(record.attributes).toContainEqual({
      key: "session.id",
      value: { stringValue: "s1" },
    });
  });

  it("maps each level to its OTel severity number", async () => {
    wire();
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    await flush();
    expect(sent.map((r) => r.severityNumber)).toEqual([5, 9, 13, 17]);
  });

  it("goes silent after stop", async () => {
    wire();
    stop();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      logger.info("after shutdown");
      await flush();
      expect(sent).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
