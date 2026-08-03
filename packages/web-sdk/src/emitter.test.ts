import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitter, type Emit } from "./emitter.js";

type SentBatch = {
  url: string;
  headers: Record<string, string>;
  keepalive: boolean | undefined;
  bodyLength: number;
  payload: {
    resourceLogs: Array<{
      resource: { attributes: Array<{ key: string; value: object }> };
      scopeLogs: Array<{
        scope: { name: string; version: string };
        logRecords: Array<{
          timeUnixNano: string;
          severityNumber: number;
          eventName: string;
          attributes: Array<{ key: string; value: object }>;
        }>;
      }>;
    }>;
  };
};

let sent: SentBatch[];
let emit: Emit;
let flush: () => Promise<void>;
let exitFlush: () => void;

function makeEmitter(envelope: () => Record<string, string> = () => ({})) {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        keepalive: init?.keepalive,
        bodyLength: String(init?.body).length,
        payload: JSON.parse(String(init?.body)),
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  return createEmitter(
    "https://ingest.example/v1/logs",
    { Authorization: "Bearer key" },
    { "service.name": "svc", "everr.screen.width": 1920 },
    { name: "@everr/web-sdk", version: "test" },
    envelope,
  );
}

function sentRecords() {
  return sent.flatMap((b) => b.payload.resourceLogs[0].scopeLogs[0].logRecords);
}

beforeEach(() => {
  vi.useFakeTimers();
  [emit, flush, exitFlush] = makeEmitter();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createEmitter", () => {
  it("batches on the scheduled delay rather than per event", async () => {
    emit("everr.browser.page_view");
    emit("everr.browser.page_view");
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(1);
    expect(sentRecords()).toHaveLength(2);
  });

  it("flushes immediately when the batch size is reached", () => {
    for (let i = 0; i < 32; i++) emit("everr.browser.page_view");
    expect(sent).toHaveLength(1);
    expect(sentRecords()).toHaveLength(32);
  });

  it("flush() sends whatever is pending and clears the timer", async () => {
    emit("everr.browser.page_view");
    await flush();
    expect(sentRecords()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
  });

  it("posts OTLP JSON with resource, scope, headers, and typed attributes", async () => {
    [emit, flush, exitFlush] = makeEmitter(() => ({ "session.id": "s1" }));
    emit("everr.browser.page_view", { "everr.navigation.type": "initial" });
    await flush();

    const batch = sent[0];
    expect(batch.url).toBe("https://ingest.example/v1/logs");
    expect(batch.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer key",
    });
    const resourceLog = batch.payload.resourceLogs[0];
    expect(resourceLog.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "svc" },
    });
    expect(resourceLog.resource.attributes).toContainEqual({
      key: "everr.screen.width",
      value: { intValue: "1920" },
    });
    const record = resourceLog.scopeLogs[0].logRecords[0];
    expect(record.eventName).toBe("everr.browser.page_view");
    expect(record.severityNumber).toBe(9);
    expect(record.timeUnixNano).toMatch(/^\d+$/);
    expect(record.attributes).toContainEqual({
      key: "session.id",
      value: { stringValue: "s1" },
    });
    expect(record.attributes).toContainEqual({
      key: "everr.navigation.type",
      value: { stringValue: "initial" },
    });
  });

  it("stamps the envelope at emit time, not flush time", async () => {
    let sessionId = "before";
    [emit, flush, exitFlush] = makeEmitter(() => ({ "session.id": sessionId }));
    emit("everr.browser.page_view");
    sessionId = "after";
    await flush();
    expect(sentRecords()[0].attributes).toContainEqual({
      key: "session.id",
      value: { stringValue: "before" },
    });
  });

  it("never drops a record on the normal flush path, whatever the burst size", async () => {
    // No queue cap until sampling exists: a burst far beyond the batch size
    // must deliver every record, via the batch-size auto-flushes plus the
    // final manual flush.
    for (let i = 0; i < 250; i++) emit("everr.browser.page_view");
    await flush();
    expect(sentRecords()).toHaveLength(250);
  });

  it("exitFlush posts with keepalive and empties the queue", () => {
    emit("everr.browser.page_view");
    exitFlush();
    expect(sent).toHaveLength(1);
    expect(sent[0].keepalive).toBe(true);
    exitFlush();
    expect(sent).toHaveLength(1);
  });

  it("truncates the exit payload to the keepalive budget, newest records first", () => {
    const filler = "x".repeat(3000);
    emit("exception", { filler });
    for (let i = 0; i < 30; i++)
      emit("everr.browser.interaction.click", { filler });
    exitFlush();

    const names = sentRecords().map((r) => r.eventName);
    expect(sent[0].bodyLength).toBeLessThanOrEqual(64_000);
    expect(names.length).toBeLessThan(31);
    // Oldest records survive: the leading exception ships, the newest
    // interactions absorb the truncation.
    expect(names[0]).toBe("exception");
  });

  it("never throws from exitFlush, even when fetch throws synchronously", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("keepalive unsupported");
      }),
    );
    emit("everr.browser.page_view");
    expect(() => exitFlush()).not.toThrow();
  });

  it("swallows transport failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const [failingEmit, failingFlush] = createEmitter(
      "https://ingest.example/v1/logs",
      undefined,
      {},
      { name: "s", version: "v" },
      () => ({}),
    );
    failingEmit("everr.browser.page_view");
    await expect(failingFlush()).resolves.toBeUndefined();
  });
});
