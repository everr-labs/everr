import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttrValue, EmitSpan } from "../../pipeline/emitter.js";
import { createTracer } from "../../pipeline/tracer.js";
import {
  type RouteTemplateResolver,
  setRouteResolver,
} from "../../state/route.js";
import { startNetwork } from "./network.js";

// Unit tests for the change to fetch. A test emitSpan function below the true
// Tracer records the calls that make a span. A replacement for fetch operates in
// place of the network. Thus the test can examine the header that the code adds
// and the arguments that the code sends to the original fetch.

type SpanCall = {
  traceId: string;
  spanId: string;
  name: string;
  attrs: Record<string, AttrValue | null | undefined>;
  error?: boolean;
};

let spans: SpanCall[];
let stop: () => void;
let lastRequest: { input: RequestInfo | URL; init?: RequestInit } | undefined;
let respondWith: () => Promise<Response>;

const emitSpan: EmitSpan = (traceId, spanId, name, _s, _e, attrs, error) => {
  spans.push({ traceId, spanId, name, attrs, error });
};

function start(
  targets?: Array<string | RegExp>,
  resolveTemplate?: RouteTemplateResolver,
) {
  if (resolveTemplate) setRouteResolver({ request: resolveTemplate });
  stop = startNetwork(createTracer(emitSpan), targets);
}

/** The headers that the changed fetch sent, in a regular form. */
function sentHeaders(): Headers {
  return new Headers(lastRequest?.init?.headers);
}

beforeEach(() => {
  spans = [];
  lastRequest = undefined;
  respondWith = () => Promise.resolve(new Response("ok", { status: 200 }));
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      lastRequest = { input, init };
      return respondWith();
    }),
  );
});

afterEach(() => {
  stop();
  setRouteResolver(null);
  vi.unstubAllGlobals();
});

describe("startNetwork", () => {
  it("emits a CLIENT span with semconv attrs and a query-stripped url", async () => {
    start();
    await fetch("/api/users?token=secret");

    expect(spans).toHaveLength(1);
    const s = spans[0];
    expect(s.name).toBe("GET /api/users");
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(s.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(s.error).toBe(false);
    expect(s.attrs["http.request.method"]).toBe("GET");
    expect(s.attrs["url.full"]).toBe(`${location.origin}/api/users`);
    expect(s.attrs["url.template"]).toBeUndefined();
    expect(s.attrs["server.address"]).toBe(location.hostname);
    expect(s.attrs["http.response.status_code"]).toBe(200);
    expect(s.attrs["error.type"]).toBeUndefined();
  });

  it("injects traceparent on same-origin requests with the span's ids", async () => {
    start();
    await fetch("/api/users");
    expect(sentHeaders().get("traceparent")).toBe(
      `00-${spans[0].traceId}-${spans[0].spanId}-01`,
    );
  });

  it("does not inject traceparent cross-origin without a matching target", async () => {
    start();
    await fetch("https://api.thirdparty.example/data");
    // The code still records the span. It only does not send the header.
    expect(spans).toHaveLength(1);
    expect(sentHeaders().get("traceparent")).toBeNull();
  });

  it("injects cross-origin when a string target substring-matches", async () => {
    start(["api.backend.example"]);
    await fetch("https://api.backend.example/v2/data");
    expect(sentHeaders().get("traceparent")).toMatch(/^00-[0-9a-f]{32}-/);
  });

  it("injects cross-origin when a RegExp target matches", async () => {
    start([/backend\.example/]);
    await fetch("https://api.backend.example/v2/data");
    expect(sentHeaders().get("traceparent")).not.toBeNull();
  });

  it("preserves existing headers when injecting, init over Request input", async () => {
    start();
    const request = new Request(`${location.origin}/api`, {
      headers: { "X-From-Request": "r" },
    });
    await fetch(request, { headers: { "X-From-Init": "i" } });
    const h = sentHeaders();
    // This is the behavior of fetch: the headers in init replace the headers of
    // the Request, and the code adds its own header to them.
    expect(h.get("X-From-Init")).toBe("i");
    expect(h.get("X-From-Request")).toBeNull();
    expect(h.get("traceparent")).not.toBeNull();
  });

  it("takes headers from a Request input when init has none", async () => {
    start();
    await fetch(
      new Request(`${location.origin}/api`, { headers: { "X-App": "a" } }),
    );
    const h = sentHeaders();
    expect(h.get("X-App")).toBe("a");
    expect(h.get("traceparent")).not.toBeNull();
    expect(spans[0].attrs["http.request.method"]).toBe("GET");
  });

  it("marks 4xx and 5xx responses as error spans with error.type", async () => {
    start();
    respondWith = () => Promise.resolve(new Response(null, { status: 404 }));
    await fetch("/missing");
    respondWith = () => Promise.resolve(new Response(null, { status: 503 }));
    await fetch("/broken");

    expect(spans[0].error).toBe(true);
    expect(spans[0].attrs["error.type"]).toBe("404");
    expect(spans[0].attrs["http.response.status_code"]).toBe(404);
    expect(spans[1].error).toBe(true);
    expect(spans[1].attrs["error.type"]).toBe("503");
  });

  it("marks network failures as error spans and rethrows to the caller", async () => {
    start();
    respondWith = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(fetch("/api")).rejects.toThrow("Failed to fetch");
    expect(spans[0].error).toBe(true);
    expect(spans[0].attrs["error.type"]).toBe("TypeError");
    expect(spans[0].attrs["http.response.status_code"]).toBeUndefined();
  });

  it("restores the original fetch on stop, but never clobbers a later patcher", () => {
    const original = fetch;
    start();
    expect(fetch).not.toBe(original);
    const foreign = vi.fn();
    globalThis.fetch = foreign as unknown as typeof fetch;
    stop();
    expect(fetch).toBe(foreign);
    globalThis.fetch = original;
    stop = () => {};
  });

  it("names the span by the request's own route template, falling back to the path", async () => {
    start(undefined, (url) =>
      url.pathname.startsWith("/api/posts/") ? "/api/posts/{id}" : null,
    );
    await fetch("/api/posts/123");
    await fetch("/api/b");
    expect(spans.map((s) => s.name)).toEqual([
      "GET /api/posts/{id}",
      "GET /api/b",
    ]);
    expect(spans[0].attrs["url.template"]).toBe("/api/posts/{id}");
    // The url.full attribute keeps the exact target.
    expect(spans[0].attrs["url.full"]).toBe(`${location.origin}/api/posts/123`);
    expect(spans[1].attrs["url.template"]).toBeUndefined();
  });

  it("takes the template from the x-everr-route response header over the resolver", async () => {
    start(undefined, () => "/from/resolver");
    respondWith = () =>
      Promise.resolve(
        new Response("ok", {
          status: 200,
          headers: { "x-everr-route": "/api/cli/runs/$traceId" },
        }),
      );
    await fetch("/api/cli/runs/abc123");
    expect(spans[0].name).toBe("GET /api/cli/runs/$traceId");
    expect(spans[0].attrs["url.template"]).toBe("/api/cli/runs/$traceId");
    expect(spans[0].attrs["url.full"]).toBe(
      `${location.origin}/api/cli/runs/abc123`,
    );
  });

  it("uppercases the method and reads it from init or the Request", async () => {
    start();
    await fetch("/api", { method: "post" });
    expect(spans[0].name).toBe("POST /api");
    await fetch(new Request(`${location.origin}/api`, { method: "PUT" }));
    expect(spans[1].attrs["http.request.method"]).toBe("PUT");
  });
});

describe("hardening", () => {
  it("passes unparsable urls straight through without a span", async () => {
    start();
    await fetch("http://");
    expect(spans).toHaveLength(0);
    expect(String(lastRequest?.input)).toBe("http://");
  });

  it("falls back to the path when the route resolver throws", async () => {
    start(undefined, () => {
      throw new Error("router exploded");
    });
    const res = await fetch("/api/posts/123");
    expect(res.status).toBe(200);
    expect(spans[0].name).toBe("GET /api/posts/123");
    expect(spans[0].attrs["url.template"]).toBeUndefined();
  });

  it("still records the span when the headers cannot be constructed", async () => {
    start();
    const invalid = { "bad name\n": "x" } as Record<string, string>;
    await fetch("/api/ping", { headers: invalid });
    expect(spans).toHaveLength(1);
    // The code added no header. Thus the init object of the caller went to
    // fetch without a change.
    expect(lastRequest?.init?.headers).toBe(invalid);
  });
});

describe("status boundaries", () => {
  it("marks exactly 400 as an error span, and 399 as success", async () => {
    start();
    respondWith = () => Promise.resolve(new Response("nope", { status: 400 }));
    await fetch("/api/bad");
    respondWith = () => Promise.resolve(new Response("odd", { status: 399 }));
    await fetch("/api/odd");
    expect(spans[0].error).toBe(true);
    expect(spans[0].attrs["error.type"]).toBe("400");
    expect(spans[1].error).toBeFalsy();
    expect(spans[1].attrs["error.type"]).toBeUndefined();
  });
});
