import { afterEach, expect, it, vi } from "vitest";
import type { WebSDK } from "./client.js";
import type { OtlpSpan } from "./test-kit.js";

let clients: WebSDK[] = [];

afterEach(async () => {
  for (const client of clients.reverse()) await client.shutdown();
  clients = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([
  "/api/telemetry",
  "http://127.0.0.1:54318",
])("does not trace SDK exports to %s across overlapping SDK instances", async (endpoint) => {
  vi.useFakeTimers();
  vi.resetModules();
  const spans: OtlpSpan[] = [];
  const exports: RequestInit[] = [];
  const nativeFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) {
      exports.push(init);
      const payload = JSON.parse(String(init.body));
      spans.push(...(payload.resourceSpans?.[0].scopeSpans[0].spans ?? []));
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  vi.stubGlobal("fetch", nativeFetch);
  const { WebSDK } = await import("./client.js");
  const { network } = await import("./instrumentations/network/index.js");
  const { logger } = await import("./logger.js");

  for (let i = 0; i < 2; i++) {
    clients.push(
      new WebSDK({
        serviceName: `self-export-${i}`,
        endpoint,
        persistence: "memory",
        instrumentations: [network()],
      }),
    );
  }
  logger.info("seed log batch");
  await fetch("/api/users");
  for (const client of clients) await client.flush();
  const requestCount = nativeFetch.mock.calls.length;
  for (const client of clients) await client.flush();

  expect(spans.map((span) => span.name)).toEqual([
    "GET /api/users",
    "GET /api/users",
  ]);
  expect(spans.every((span) => span.kind === 3)).toBe(true);
  expect(exports).toHaveLength(3);
  expect(
    exports.every((init) => !new Headers(init.headers).has("traceparent")),
  ).toBe(true);
  await vi.advanceTimersByTimeAsync(45_000);
  expect(nativeFetch).toHaveBeenCalledTimes(requestCount);
});
