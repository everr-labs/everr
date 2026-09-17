import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startNetwork } from "../instrumentations/network/network.js";
import { createTracer } from "./tracer.js";

let resolveTransport: typeof import("./transport.js").resolveTransport;
let posted: Posted[];
let stopNetwork: (() => void) | undefined;

type Posted = { url: string; init: RequestInit | undefined };

function stubFetch() {
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      posted.push({ url: String(url), init });
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  return posted;
}

beforeEach(async () => {
  vi.resetModules();
  stubFetch();
  ({ resolveTransport } = await import("./transport.js"));
});

afterEach(() => {
  stopNetwork?.();
  stopNetwork = undefined;
  vi.unstubAllGlobals();
});

describe("export self-tracing", () => {
  it.each([
    "/api/telemetry",
    "http://127.0.0.1:54318",
  ])("does not trace exports to %s when network instrumentation starts first", async (endpoint) => {
    const emitSpan = vi.fn();
    stopNetwork = startNetwork(createTracer(emitSpan), undefined);
    const transport = resolveTransport({ endpoint });
    expect(transport).not.toBeNull();
    const [send] = transport ?? [];

    await fetch("/api/users");
    await send?.("logs", '{"resourceLogs":[]}');
    await send?.("traces", '{"resourceSpans":[]}', true);

    expect(posted.map((p) => p.url)).toEqual([
      "/api/users",
      `${endpoint}/v1/logs`,
      `${endpoint}/v1/traces`,
    ]);
    expect(emitSpan.mock.calls.map((call) => call[2])).toEqual([
      "GET /api/users",
    ]);
    for (const post of posted.slice(1)) {
      expect(new Headers(post.init?.headers).has("traceparent")).toBe(false);
    }
  });
});

describe("resolveTransport: endpoint resolution", () => {
  it("sends to the hosted ingest with a Bearer header when a key is set", () => {
    const [send, truncateAtExit] =
      resolveTransport({ ingestKey: "pub_abc" }) ?? [];
    send?.("logs", "{}");
    send?.("traces", "{}");

    expect(truncateAtExit).toBe(true);
    expect(posted.map((p) => p.url)).toEqual([
      "https://ingest.everr.dev/v1/logs",
      "https://ingest.everr.dev/v1/traces",
    ]);
    expect(posted[0].init?.headers).toMatchObject({
      Authorization: "Bearer pub_abc",
      "Content-Type": "application/json",
    });
  });

  it("prefers an explicit endpoint override, appending the OTLP path and keeping the key's header", () => {
    resolveTransport({
      ingestKey: "pub_abc",
      endpoint: "https://collector.example/",
    })?.[0]("logs", "{}");

    expect(posted[0].url).toBe("https://collector.example/v1/logs");
    expect(posted[0].init?.headers).toMatchObject({
      Authorization: "Bearer pub_abc",
    });
  });

  it("carries no Authorization header without a key", () => {
    resolveTransport({ endpoint: "https://collector.example" })?.[0](
      "traces",
      "{}",
    );

    expect(posted[0].url).toBe("https://collector.example/v1/traces");
    expect(posted[0].init?.headers).not.toHaveProperty("Authorization");
  });

  it("falls back to the local collector in dev with no key", () => {
    resolveTransport({ dev: true })?.[0]("logs", "{}");

    expect(posted[0].url).toBe("http://127.0.0.1:54418/v1/logs");
  });

  it("forwards keepalive on the exit path", () => {
    resolveTransport({ dev: true })?.[0]("logs", "{}", true);

    expect(posted[0].init?.keepalive).toBe(true);
  });

  it("resolves to null (structural no-op) for a keyless production build", () => {
    expect(resolveTransport({})).toBeNull();
    expect(resolveTransport({ ingestKey: "   " })).toBeNull();
  });
});

describe("resolveTransport: caller-supplied send", () => {
  it("routes both signals to send and issues no request of its own", () => {
    const send = vi.fn();
    const [deliver] = resolveTransport({ send }) ?? [];

    deliver?.("logs", '{"resourceLogs":[]}');
    deliver?.("traces", '{"resourceSpans":[]}');

    expect(send.mock.calls).toEqual([
      ["logs", '{"resourceLogs":[]}'],
      ["traces", '{"resourceSpans":[]}'],
    ]);
    expect(posted).toHaveLength(0);
  });

  it("never resolves to null, even with no key, endpoint, or dev flag", () => {
    expect(resolveTransport({ send: vi.fn() })).not.toBeNull();
  });

  it("wins over a key and an endpoint", () => {
    const send = vi.fn();
    resolveTransport({
      send,
      ingestKey: "pub_abc",
      endpoint: "https://collector.example",
    })?.[0]("logs", "{}");

    expect(send).toHaveBeenCalledOnce();
    expect(posted).toHaveLength(0);
  });

  it("turns off exit truncation: the keepalive budget is a fetch constraint", () => {
    expect(resolveTransport({ send: vi.fn() })?.[1]).toBe(false);
  });

  it("does not pass keepalive through: it is meaningless to a host transport", () => {
    const send = vi.fn();
    resolveTransport({ send })?.[0]("logs", "{}", true);

    expect(send).toHaveBeenCalledWith("logs", "{}");
  });
});
