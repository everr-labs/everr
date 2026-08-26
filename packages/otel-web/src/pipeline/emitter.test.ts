import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BeforeSend,
  createEmitter,
  type Emit,
  type EmitSpan,
} from "./emitter.js";
import { fetchSend } from "./transport.js";

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
          body: object;
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

function makeEmitter(
  envelope: () => Record<string, string> = () => ({}),
  beforeSend?: BeforeSend,
) {
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
    beforeSend,
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

  it("truncates the exit payload to the keepalive budget, oldest records first", () => {
    const filler = "x".repeat(3000);
    // The sequence of a true exit: the interactions of the page, then the
    // records that the hide handlers make immediately before the truncation.
    // The total stays below the batch size, and thus no usual flush operates
    // and all the records are on the exit path.
    for (let i = 0; i < 29; i++)
      emit("everr.browser.interaction.click", { filler });
    emit("browser.web_vital", { filler });
    emit("everr.browser.page_leave", { filler });
    exitFlush();

    const names = sentRecords().map((r) => r.eventName);
    expect(sent).toHaveLength(1);
    expect(sent[0].bodyLength).toBeLessThanOrEqual(64_000);
    expect(names.length).toBeLessThan(31);
    // The records of the exit are the most recent records, and thus they stay.
    // The code removes the interactions at the front of the queue, which had
    // the full delay of the batch to go out on a usual flush.
    expect(names.at(-1)).toBe("everr.browser.page_leave");
    expect(names.at(-2)).toBe("browser.web_vital");
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

  it("ships the parent span id of a child, and none for a root", async () => {
    emitSpan("a".repeat(32), "b".repeat(16), "PageLoad", 1, 2, {});
    emitSpan(
      "a".repeat(32),
      "c".repeat(16),
      "work",
      1,
      2,
      {},
      false,
      "b".repeat(16),
    );
    await flush();
    const payload = sent[0].payload as unknown as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<Record<string, unknown>> }>;
      }>;
    };
    const [root, child] = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(root.parentSpanId).toBeUndefined();
    expect(child.parentSpanId).toBe("b".repeat(16));
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

  it("beforeSend can change the name and the attributes of a span", async () => {
    [emit, flush, exitFlush, emitSpan] = makeEmitter(
      () => ({ "url.full": "https://app.example/reset?token=s3cret" }),
      (item) => ({
        ...item,
        ...(item.kind === "span" ? { name: "redacted" } : {}),
        attributes: {
          ...item.attributes,
          "url.full": String(item.attributes["url.full"]).split("?")[0],
        },
      }),
    );
    emitSpan("a".repeat(32), "b".repeat(16), "GET /api", 1, 2, {
      "http.request.method": "GET",
    });
    await flush();

    const span = (
      sent[0].payload as unknown as {
        resourceSpans: Array<{
          scopeSpans: Array<{
            spans: Array<{
              name: string;
              attributes: Array<{
                key: string;
                value: { stringValue: string };
              }>;
            }>;
          }>;
        }>;
      }
    ).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("redacted");
    // The hook sees the envelope, and thus it can reach url.full.
    expect(
      span.attributes.find((a) => a.key === "url.full")?.value.stringValue,
    ).toBe("https://app.example/reset");
    expect(span.attributes.map((a) => a.key)).toContain("http.request.method");
  });

  it("beforeSend drops the span when it returns null", async () => {
    [emit, flush, exitFlush, emitSpan] = makeEmitter(
      () => ({}),
      (item) => (item.kind === "span" ? null : item),
    );
    emitSpan("a".repeat(32), "b".repeat(16), "GET /api", 1, 2, {});
    emit("everr.browser.page_view");
    await flush();

    // The traces post is absent, and the log record still goes out. Thus the
    // hook can select one signal.
    expect(sent.map((b) => b.url)).toEqual(["https://ingest.example/v1/logs"]);
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

describe("beforeSend on the log path", () => {
  it("changes the body, the attributes, the event name and the severity", async () => {
    [emit, flush, exitFlush, emitSpan] = makeEmitter(
      () => ({ "url.full": "https://app.example/reset?token=s3cret" }),
      (item) => {
        if (item.kind !== "log") return item;
        return {
          ...item,
          eventName: "everr.browser.page_view",
          severityNumber: 13,
          body: item.body.replace(/tok_\w+/g, "[redacted]"),
          attributes: {
            ...item.attributes,
            "url.full": String(item.attributes["url.full"]).split("?")[0],
          },
        };
      },
    );
    emit("exception", { "exception.type": "Error" }, 17, "Error: tok_abc");
    await flush();

    const record = sentRecords()[0];
    expect(record.eventName).toBe("everr.browser.page_view");
    expect(record.severityNumber).toBe(13);
    expect(record.body).toEqual({ stringValue: "Error: [redacted]" });
    expect(record.attributes).toContainEqual({
      key: "url.full",
      value: { stringValue: "https://app.example/reset" },
    });
    expect(record.attributes.map((a) => a.key)).toContain("exception.type");
  });

  it("drops the record when it returns null", async () => {
    [emit, flush, exitFlush, emitSpan] = makeEmitter(
      () => ({}),
      (item) =>
        item.kind === "log" && item.eventName === "exception" ? null : item,
    );
    emit("exception", {}, 17, "boom");
    emit("everr.browser.page_view");
    await flush();

    expect(sentRecords().map((r) => r.eventName)).toEqual([
      "everr.browser.page_view",
    ]);
  });

  it("sees a logger.* record, whose event name is empty", async () => {
    const seen: string[] = [];
    [emit, flush, exitFlush, emitSpan] = makeEmitter(
      () => ({}),
      (item) => {
        if (item.kind === "log") seen.push(item.eventName);
        return item;
      },
    );
    // This is the shape that logger.info() sends.
    emit("", { feature: "billing" }, 9, "checkout started");
    await flush();
    expect(seen).toEqual([""]);
    expect(sentRecords()[0].body).toEqual({ stringValue: "checkout started" });
  });

  it("drops the item and warns one time when the hook throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    [emit, flush, exitFlush, emitSpan] = makeEmitter(
      () => ({}),
      () => {
        throw new Error("bad hook");
      },
    );
    // The hook operates in a listener of the page. Thus its error must not go
    // to the page.
    expect(() => emit("everr.browser.page_view")).not.toThrow();
    emit("everr.browser.page_view");
    emitSpan("a".repeat(32), "b".repeat(16), "GET /api", 1, 2, {});
    await flush();

    // The SDK sent nothing: an item that did not go through the hook must not
    // go on the wire.
    expect(sent).toHaveLength(0);
    // Three items, one warning.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("exit budget and transport hardening", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    [emit, flush, exitFlush, emitSpan] = makeEmitter();
  });

  it("truncates exit spans to a quarter of the keepalive budget, oldest first", () => {
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
    // The most recent spans stay, because the code removes the spans at the
    // front of the queue first.
    expect(names.at(-1)).toBe("span-29");
  });

  it("sends nothing when the one record in the queue is above the budget", () => {
    // The record alone is larger than the keepalive limit. A payload that
    // carries it makes fetch refuse the request, and thus the batch is lost
    // without a record of the loss. The code discards it and sends no payload.
    emit("everr.browser.interaction.click", { filler: "x".repeat(70_000) });
    exitFlush();
    expect(sent.find((b) => b.url.endsWith("/v1/logs"))).toBeUndefined();
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
