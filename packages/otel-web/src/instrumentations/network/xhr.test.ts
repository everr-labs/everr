import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracer } from "../../pipeline/tracer.js";
import { setRouteResolver } from "../../state/route.js";
import { startNetwork } from "./network.js";

// A controllable transport keeps these tests independent of network timing.
// EventTarget is the real DOM implementation, including capture ordering.
class TestXHR extends EventTarget {
  readyState = 0;
  status = 0;
  headers = new Headers();
  responseHeaders = new Headers();
  body: unknown;
  async = true;
  sent = false;
  failSend = false;
  failHeader = false;
  openArgs: unknown[] = [];

  open(
    method: string,
    url: string | URL,
    async = true,
    ...credentials: unknown[]
  ) {
    if (!method || String(url) === "http://")
      throw new DOMException("Invalid request", "SyntaxError");
    this.openArgs = [method, url, async, ...credentials];
    this.async = async;
    this.headers = new Headers();
    this.responseHeaders = new Headers();
    this.status = 0;
    this.sent = false;
    this.readyState = 1;
    this.dispatchEvent(new Event("readystatechange"));
  }

  setRequestHeader(name: string, value: string) {
    if (this.failHeader || this.readyState !== 1 || this.sent)
      throw new DOMException("Invalid state", "InvalidStateError");
    this.headers.append(name, value);
  }

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name);
  }

  send(body?: unknown) {
    if (this.readyState !== 1 || this.sent)
      throw new DOMException("Invalid state", "InvalidStateError");
    if (this.failSend)
      throw new DOMException("Transport failed", "NetworkError");
    this.body = body;
    this.sent = true;
    if (!this.async) this.complete();
  }

  complete(status = 200, event = "load") {
    this.status = status;
    this.readyState = 4;
    this.sent = false;
    this.dispatchEvent(new Event("readystatechange"));
    this.dispatchEvent(new Event(event));
    this.dispatchEvent(new Event("loadend"));
  }

  abort() {
    this.complete(0, "abort");
    this.readyState = 0;
  }
}

const native = {
  open: TestXHR.prototype.open,
  send: TestXHR.prototype.send,
  setRequestHeader: TestXHR.prototype.setRequestHeader,
};
const emit = vi.fn();
let stop = () => {};
const tracer = () => createTracer(emit);
const spans = () =>
  emit.mock.calls.map(
    ([traceId, spanId, name, start, end, attrs, error, parent, kind]) => ({
      traceId,
      spanId,
      name,
      start,
      end,
      attrs,
      error,
      parent,
      kind,
    }),
  );
function start(targets?: (string | RegExp)[]) {
  stop = startNetwork(tracer(), targets);
}
function request(url = "/api/users?token=secret#fragment") {
  const xhr = new TestXHR();
  xhr.open("GET", url);
  xhr.send();
  return xhr;
}

beforeEach(() => {
  emit.mockClear();
  vi.stubGlobal("XMLHttpRequest", TestXHR);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
});
afterEach(() => {
  stop();
  Object.assign(TestXHR.prototype, native);
  setRouteResolver(null);
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("XHR network instrumentation", () => {
  it("emits one CLIENT span with sanitized request attrs and matching propagation", () => {
    start();
    const xhr = request();
    expect(spans()).toHaveLength(0);
    xhr.complete();
    expect(spans()).toHaveLength(1);
    expect(spans()[0]).toMatchObject({
      name: "GET /api/users",
      kind: 3,
      error: false,
      attrs: {
        "http.request.method": "GET",
        "http.response.status_code": 200,
        "url.full": `${location.origin}/api/users`,
        "server.address": location.hostname,
      },
    });
    expect(xhr.headers.get("traceparent")).toBe(
      `00-${spans()[0].traceId}-${spans()[0].spanId}-01`,
    );
    expect(JSON.stringify(spans())).not.toContain("secret");
  });

  it.each([
    undefined,
    ["backend.example"],
    [/backend\.example/],
  ])("uses propagation targets %j", (targets) => {
    start(targets);
    const xhr = request("https://backend.example/api");
    expect(Boolean(xhr.headers.get("traceparent"))).toBe(Boolean(targets));
    xhr.complete();
    expect(spans()).toHaveLength(1);
  });

  it("honors the document base URL and avoids cross-origin propagation", () => {
    document.head.innerHTML = '<base href="https://cdn.example/assets/">';
    start();
    const xhr = request("data");
    xhr.complete();
    expect(xhr.headers.has("traceparent")).toBe(false);
    expect(spans()[0].attrs["url.full"]).toBe(
      "https://cdn.example/assets/data",
    );
  });

  it("preserves application headers, request body and open arguments", () => {
    start();
    const xhr = new TestXHR();
    const body = new FormData();
    body.append("password", "secret");
    xhr.open("post", "/api", true, "user", "password");
    xhr.setRequestHeader("X-App", "value");
    xhr.send(body);
    xhr.complete();
    expect(xhr.headers.get("traceparent")).toBe(
      `00-${spans()[0].traceId}-${spans()[0].spanId}-01`,
    );
    expect(xhr.headers.get("X-App")).toBe("value");
    expect(xhr.body).toBe(body);
    expect(xhr.openArgs).toEqual(["post", "/api", true, "user", "password"]);
    expect(spans()[0].name).toBe("POST /api");
    expect(JSON.stringify(spans())).not.toContain("secret");
  });

  it("uses the request resolver and prefers the server's route echo", () => {
    setRouteResolver({ request: () => "/api/{id}" });
    start();
    const first = request("/api/123");
    first.complete();
    const second = request("/api/456");
    second.responseHeaders.set("x-everr-route", "/api/$id");
    second.complete();
    expect(spans().map((s) => [s.name, s.attrs["url.template"]])).toEqual([
      ["GET /api/{id}", "/api/{id}"],
      ["GET /api/$id", "/api/$id"],
    ]);
  });

  it.each([399, 400, 404, 503])("records HTTP status %i", (status) => {
    start();
    request().complete(status);
    expect(spans()[0].error).toBe(status >= 400);
    expect(spans()[0].attrs["error.type"]).toBe(
      status >= 400 ? String(status) : undefined,
    );
  });

  it.each([
    ["error", "NetworkError"],
    ["timeout", "TimeoutError"],
    ["abort", undefined],
  ])("handles %s exactly once without a fabricated HTTP status", (event, errorType) => {
    start();
    const xhr = request();
    xhr.complete(0, event);
    xhr.dispatchEvent(new Event("loadend"));
    expect(spans()).toHaveLength(1);
    expect(spans()[0].attrs["error.type"]).toBe(errorType);
    expect(spans()[0].error).toBe(Boolean(errorType));
    expect(spans()[0].attrs["http.response.status_code"]).toBeUndefined();
  });

  it("handles synchronous completion and synchronous send errors", () => {
    start();
    const xhr = new TestXHR();
    xhr.open("GET", "/sync", false);
    xhr.send();
    expect(spans()).toHaveLength(1);
    xhr.open("GET", "/failure", false);
    xhr.failSend = true;
    expect(() => xhr.send()).toThrow("Transport failed");
    expect(spans()).toHaveLength(2);
    expect(spans()[1].attrs["error.type"]).toBe("NetworkError");
  });

  it("keeps invalid/duplicate sends and failed opens from corrupting an active span", () => {
    start();
    const xhr = new TestXHR();
    expect(() => xhr.send()).toThrow();
    expect(() => xhr.open("GET", "http://")).toThrow();
    expect(spans()).toHaveLength(0);
    xhr.open("GET", "/active");
    xhr.send();
    expect(() => xhr.send()).toThrow();
    expect(() => xhr.open("GET", "http://")).toThrow();
    expect(spans()).toHaveLength(0);
    xhr.complete();
    expect(spans().map((s) => s.name)).toEqual(["GET /active"]);
  });

  it("resets headers and span state when an XHR object is reused", () => {
    start();
    const xhr = request("/first");
    const firstHeader = xhr.headers.get("traceparent");
    xhr.complete();
    xhr.open("GET", "/second");
    xhr.send();
    xhr.complete();
    expect(spans().map((s) => s.name)).toEqual(["GET /first", "GET /second"]);
    expect(xhr.headers.get("traceparent")).not.toBe(firstHeader);
  });

  it("finishes a replaced in-flight request without marking cancellation as an error", () => {
    start();
    const xhr = request("/first");
    xhr.open("GET", "/second");
    xhr.send();
    xhr.complete();
    expect(spans().map((s) => [s.name, s.error])).toEqual([
      ["GET /first", false],
      ["GET /second", false],
    ]);
    expect(spans()[0].attrs["http.response.status_code"]).toBeUndefined();
  });

  it("captures requests sent inside the OPENED callback", () => {
    start();
    const xhr = new TestXHR();
    xhr.addEventListener("readystatechange", () => {
      if (xhr.readyState === 1) xhr.send();
    });
    xhr.open("GET", "/opened");
    xhr.complete();
    expect(spans().map((s) => s.name)).toEqual(["GET /opened"]);
  });

  it("handles reuse from a DONE callback before the old load/loadend events", () => {
    start();
    const xhr = request("/first");
    xhr.addEventListener(
      "readystatechange",
      () => {
        if (xhr.readyState === 4) {
          xhr.open("GET", "/second");
          xhr.send();
        }
      },
      { once: true },
    );
    xhr.complete(201);
    expect(spans().map((s) => s.name)).toEqual(["GET /first"]);
    xhr.complete(202);
    expect(
      spans().map((s) => [s.name, s.attrs["http.response.status_code"]]),
    ).toEqual([
      ["GET /first", 201],
      ["GET /second", 202],
    ]);
  });

  it("keeps the completed status when an earlier callback reopens the request", () => {
    start();
    const xhr = new TestXHR();
    let second = false;
    xhr.addEventListener(
      "readystatechange",
      () => {
        if (xhr.readyState === 4 && !second) {
          second = true;
          xhr.open("GET", "/second");
          xhr.send();
        }
      },
      true,
    );
    xhr.open("GET", "/first");
    xhr.send();
    xhr.complete(503);
    xhr.complete(200);
    expect(
      spans().map((s) => [
        s.name,
        s.attrs["http.response.status_code"],
        s.error,
      ]),
    ).toEqual([
      ["GET /first", 503, true],
      ["GET /second", 200, false],
    ]);
  });

  it("continues requests when header injection fails", () => {
    start();
    const xhr = new TestXHR();
    xhr.open("GET", "/api");
    xhr.failHeader = true;
    xhr.send();
    xhr.complete();
    expect(spans()).toHaveLength(1);
    expect(xhr.headers.has("traceparent")).toBe(false);
  });

  it("inherits the active trace at send time, not open time", () => {
    const t = tracer();
    stop = startNetwork(t, undefined);
    const xhr = new TestXHR();
    xhr.open("GET", "/api");
    t.startActiveSpan("parent", (parent) => {
      xhr.send();
      xhr.complete();
      expect(spans()[0].parent).toBe(parent.spanContext().spanId);
      expect(spans()[0].traceId).toBe(parent.spanContext().traceId);
      parent.end();
    });
  });

  it("restores methods and detaches in-flight listeners without aborting I/O", () => {
    start();
    const xhr = request();
    stop();
    expect(TestXHR.prototype.open).toBe(native.open);
    expect(TestXHR.prototype.send).toBe(native.send);
    expect(TestXHR.prototype.setRequestHeader).toBe(native.setRequestHeader);
    expect(xhr.sent).toBe(true);
    xhr.complete();
    expect(spans()).toHaveLength(0);
    start();
    request("/restart").complete();
    expect(spans()).toHaveLength(1);
  });

  it("does not clobber later wrappers and leaves retained wrappers inert", () => {
    start();
    const wrapped = TestXHR.prototype.send;
    const foreign = vi.fn(function (this: TestXHR, body) {
      return wrapped.call(this, body);
    });
    TestXHR.prototype.send = foreign;
    stop();
    expect(TestXHR.prototype.send).toBe(foreign);
    request().complete();
    expect(spans()).toHaveLength(0);
  });

  it("keeps fetch working when XMLHttpRequest is unavailable", async () => {
    vi.stubGlobal("XMLHttpRequest", undefined);
    start();
    await fetch("/api");
    expect(spans()).toHaveLength(1);
  });
});
