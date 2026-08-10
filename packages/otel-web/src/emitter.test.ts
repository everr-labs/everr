import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSend } from "./config.js";
import { createEmitter, type Emit, type EmitSpan } from "./emitter.js";

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
let emitSpan: EmitSpan;

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
    fetchSend(
      "https://ingest.example/v1/logs",
      "https://ingest.example/v1/traces",
      { Authorization: "Bearer key" },
    ),
    true,
    { "service.name": "svc", "everr.screen.width": 1920 },
    { name: "@everr/otel-web", version: "test" },
    envelope,
  );
}

function sentRecords() {
  return sent.flatMap((b) => b.payload.resourceLogs[0].scopeLogs[0].logRecords);
}

beforeEach(() => {
  vi.useFakeTimers();
  [emit, flush, exitFlush, emitSpan] = makeEmitter();
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
    // The queue has no limit until the sampling exists. Thus a large number of
    // records, much more than the batch size, must all go to the server. The
    // automatic flushes at the batch size and the last manual flush send them.
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
    // The oldest records stay. Thus the SDK sends the first exception record,
    // and it removes the most recent interaction records.
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
      fetchSend(
        "https://ingest.example/v1/logs",
        "https://ingest.example/v1/traces",
        undefined,
      ),
      true,
      {},
      { name: "s", version: "v" },
      () => ({}),
    );
    failingEmit("everr.browser.page_view");
    await expect(failingFlush()).resolves.toBeUndefined();
  });
});

describe("span pipeline", () => {
  it("ships spans as OTLP resourceSpans to the sibling /v1/traces path", async () => {
    [emit, flush, exitFlush, emitSpan] = makeEmitter(() => ({
      "session.id": "s1",
    }));
    emitSpan("a".repeat(32), "b".repeat(16), "GET /api", 1000, 1400, {
      "http.request.method": "GET",
    });
    await flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://ingest.example/v1/traces");
    const payload = sent[0].payload as unknown as {
      resourceSpans: Array<{
        resource: { attributes: Array<{ key: string }> };
        scopeSpans: Array<{
          spans: Array<Record<string, unknown>>;
        }>;
      }>;
    };
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("GET /api");
    expect(span.kind).toBe(3);
    expect(span.startTimeUnixNano).toBe("1000000000");
    expect(span.endTimeUnixNano).toBe("1400000000");
    expect(span.status).toBeUndefined();
    // The span attributes carry the envelope, the same as the log records.
    const keys = (span.attributes as Array<{ key: string }>).map((a) => a.key);
    expect(keys).toContain("session.id");
    expect(keys).toContain("http.request.method");
  });

  it("marks error spans with OTLP status ERROR", async () => {
    emitSpan("a".repeat(32), "b".repeat(16), "GET /api", 1, 2, {}, true);
    await flush();
    const payload = sent[0].payload as unknown as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ status: { code?: number } }> }>;
      }>;
    };
    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].status).toEqual({
      code: 2,
    });
  });

  it("flushes logs and spans as two posts on one timer", async () => {
    emit("everr.browser.page_view");
    emitSpan("a".repeat(32), "b".repeat(16), "GET /api", 1, 2, {});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent.map((b) => b.url).sort()).toEqual([
      "https://ingest.example/v1/logs",
      "https://ingest.example/v1/traces",
    ]);
  });
});

describe("exit budget and transport hardening", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    [emit, flush, exitFlush, emitSpan] = makeEmitter();
  });

  it("truncates exit spans to a quarter of the keepalive budget, newest first", () => {
    const filler = "x".repeat(3000);
    for (let i = 0; i < 30; i++) {
      emitSpan("a".repeat(32), "b".repeat(16), `span-${i}`, 1, 2, { filler });
    }
    exitFlush();
    const traces = sent.find((b) => b.url.endsWith("/v1/traces"));
    expect(traces?.keepalive).toBe(true);
    expect(traces?.bodyLength).toBeLessThanOrEqual(16_000);
    const payload = traces?.payload as unknown as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ name: string }> }>;
      }>;
    };
    const names = payload.resourceSpans[0].scopeSpans[0].spans.map(
      (s) => s.name,
    );
    expect(names.length).toBeLessThan(30);
    // The oldest spans stay, because the code removes the most recent spans
    // first.
    expect(names[0]).toBe("span-0");
  });

  it("shares the exit budget: queued spans shrink what log records may fill", () => {
    const filler = "x".repeat(3000);
    for (let i = 0; i < 4; i++) {
      emitSpan("a".repeat(32), "b".repeat(16), `span-${i}`, 1, 2, { filler });
    }
    for (let i = 0; i < 20; i++)
      emit("everr.browser.interaction.click", { filler });
    exitFlush();
    const logs = sent.find((b) => b.url.endsWith("/v1/logs"));
    const traces = sent.find((b) => b.url.endsWith("/v1/traces"));
    expect(traces).toBeDefined();
    expect(
      (logs?.bodyLength ?? 0) + (traces?.bodyLength ?? 0),
    ).toBeLessThanOrEqual(64_000);
  });

  it("swallows a synchronously-throwing fetch on every delivery path", async () => {
    // The transport keeps its reference to fetch when the code makes it. Thus
    // the replacement that throws an error must be in place before the code
    // makes the emitter, and then the test examines the true catch path.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("blocked");
      }),
    );
    const [emitB, flushB, exitFlushB, emitSpanB] = createEmitter(
      fetchSend(
        "https://ingest.example/v1/logs",
        "https://ingest.example/v1/traces",
        undefined,
      ),
      true,
      {},
      { name: "@everr/otel-web", version: "test" },
      () => ({}),
    );
    emitB("everr.browser.page_view");
    emitSpanB("a".repeat(32), "b".repeat(16), "GET /x", 1, 2, {});
    await expect(flushB()).resolves.toBeUndefined();
    emitB("everr.browser.page_view");
    expect(() => exitFlushB()).not.toThrow();
  });
});

describe("a caller-supplied send owns delivery", () => {
  type Delivered = { signal: string; body: string };

  function makeSendEmitter(
    send: (signal: string, body: string) => unknown,
    truncateAtExit = false,
  ) {
    return createEmitter(
      send,
      truncateAtExit,
      {},
      { name: "@everr/otel-web", version: "test" },
      () => ({}),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("ships the whole exit batch: no keepalive budget applies", () => {
    const delivered: Delivered[] = [];
    const [emitC, , exitFlushC] = makeSendEmitter((signal, body) => {
      delivered.push({ signal, body });
    });

    // Under MAX_BATCH_SIZE so nothing auto-flushes: the exit path sees the
    // whole queue, and the payload is comfortably past the keepalive budget.
    const filler = "x".repeat(4000);
    for (let i = 0; i < 20; i++)
      emitC("everr.browser.interaction.click", { filler, i });
    exitFlushC();

    const logs = delivered.find((d) => d.signal === "logs");
    expect(logs).toBeDefined();
    expect(logs?.body.length).toBeGreaterThan(64_000);
    const payload = JSON.parse(logs?.body ?? "{}") as {
      resourceLogs: Array<{
        scopeLogs: Array<{ logRecords: unknown[] }>;
      }>;
    };
    expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(20);
  });

  it("still truncates when the transport asks for it", () => {
    const delivered: Delivered[] = [];
    const [emitC, , exitFlushC] = makeSendEmitter((signal, body) => {
      delivered.push({ signal, body });
    }, true);

    // Under MAX_BATCH_SIZE so nothing auto-flushes: the exit path sees the
    // whole queue, and the payload is comfortably past the keepalive budget.
    const filler = "x".repeat(4000);
    for (let i = 0; i < 20; i++)
      emitC("everr.browser.interaction.click", { filler, i });
    exitFlushC();

    expect(delivered[0].body.length).toBeLessThanOrEqual(64_000);
  });

  it("swallows a synchronously-throwing send", async () => {
    const [emitC, flushC, exitFlushC] = makeSendEmitter(() => {
      throw new Error("host refused");
    });

    emitC("everr.browser.page_view");
    await expect(flushC()).resolves.toBeUndefined();
    emitC("everr.browser.page_view");
    expect(() => exitFlushC()).not.toThrow();
  });

  it("swallows a rejecting send", async () => {
    const [emitC, flushC] = makeSendEmitter(() =>
      Promise.reject(new Error("proxy down")),
    );

    emitC("everr.browser.page_view");
    await expect(flushC()).resolves.toBeUndefined();
  });

  it("flush awaits the promise send returns", async () => {
    let settled = false;
    const [emitC, flushC] = makeSendEmitter(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 50),
        ),
    );

    emitC("everr.browser.page_view");
    const pending = flushC();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(settled).toBe(true);
  });
});
