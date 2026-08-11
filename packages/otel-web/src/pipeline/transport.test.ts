import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTransport } from "./transport.js";

type Posted = { url: string; init: RequestInit | undefined };

function stubFetch() {
  const posted: Posted[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      posted.push({ url: String(url), init });
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  return posted;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveTransport: endpoint resolution", () => {
  it("sends to the hosted ingest with a Bearer header when a key is set", () => {
    const posted = stubFetch();
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
    const posted = stubFetch();
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
    const posted = stubFetch();
    resolveTransport({ endpoint: "https://collector.example" })?.[0](
      "traces",
      "{}",
    );

    expect(posted[0].url).toBe("https://collector.example/v1/traces");
    expect(posted[0].init?.headers).not.toHaveProperty("Authorization");
  });

  it("falls back to the local collector in dev with no key", () => {
    const posted = stubFetch();
    resolveTransport({})?.[0]("logs", "{}");

    expect(posted[0].url).toBe("http://127.0.0.1:54318/v1/logs");
  });

  it("forwards keepalive on the exit path", () => {
    const posted = stubFetch();
    resolveTransport({})?.[0]("logs", "{}", true);

    expect(posted[0].init?.keepalive).toBe(true);
  });

  it("resolves to null (structural no-op) for a keyless production build", () => {
    // A production build removes the local collector, and thus a build with no
    // key and no endpoint has no address to send to.
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveTransport({})).toBeNull();
    expect(resolveTransport({ ingestKey: "   " })).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("resolveTransport: caller-supplied send", () => {
  it("routes both signals to send and issues no request of its own", () => {
    const posted = stubFetch();
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

  it("never resolves to null, even with no key or endpoint", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveTransport({ send: vi.fn() })).not.toBeNull();
    vi.unstubAllEnvs();
  });

  it("wins over a key and an endpoint", () => {
    const posted = stubFetch();
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
