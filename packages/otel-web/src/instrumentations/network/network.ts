import type { Tracer } from "@opentelemetry/api";
import { errorTypeOf } from "../../errors.js";

// The network signal. This module changes window.fetch. Thus each request does
// two things. First, it becomes an OTel CLIENT span on the traces pipeline.
// Second, it carries a W3C traceparent header when that is safe. Thus the
// request of the browser is the root of the distributed trace, and the spans of
// the server are below it.
//
// By default the header goes only to the same origin. A traceparent header on a
// request to a different origin causes a CORS preflight request. That request
// fails when the server does not permit the header. Thus you must put a server
// of a different origin in the `tracePropagationTargets` option. A string must
// occur in the full URL, and a RegExp must agree with the full URL. The SDK
// records a span for each request in all conditions, and the option controls
// only the header.
//
// The Tracer of the SDK makes the spans, and the instrumentations use that same
// Tracer. Each request is its own trace, and the SDK always samples it. The ids
// of that trace go into the traceparent header. The envelope attributes on the
// span connect the span to the page view and the session.
//
// The telemetry POST operations of the SDK never come to this changed fetch.
// The emitter kept its reference to fetch before this module changed the
// global. Thus the SDK cannot make a span for its own batch.
//
// The attributes agree with the semconv for an HTTP client span. In that
// semconv, url.full on a client span is the URL of the REQUEST. Thus it
// replaces the url.* keys of the page context in the envelope, and this is
// correct. The code removes the query string, and this is also correct: a query
// string can contain a token or personal data, and the privacy limits of this
// package never permit a capture of a value. A 4xx status and a 5xx status both
// make the span an error.
//
// The changed fetch must never cause a failure of the page. If the code cannot
// read the URL, it calls the original fetch with the same arguments. If it
// cannot copy the headers, it sends no traceparent header. The shutdown
// restores the original fetch only when the global fetch is still the function
// of this module. Thus a module that changed fetch after this module wins, and
// this module wins in the opposite condition.

export type PropagationTarget = string | RegExp;

/**
 * Changes the URL of a request into its route template, which is the semconv
 * attribute `url.template`. That template has a small number of different
 * values. For example, it changes `/api/posts/123` into `/api/posts/{id}`.
 */
export type RouteTemplateResolver = (url: URL) => string | null | undefined;

export function startNetwork(
  tracer: Tracer,
  targets: PropagationTarget[] | undefined,
  resolveTemplate: RouteTemplateResolver | undefined,
): () => void {
  const original = fetch;

  const patched = function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let url: URL;
    try {
      url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
    } catch {
      return original.call(this, input, init);
    }
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    // The code reads the parts of the URL one time. Thus the function at the
    // end keeps only strings, and it does not keep the URL object.
    const path = url.pathname;
    // The route template of the request. The host calculates it from the URL of
    // the request. The route pattern of the page describes the document, and it
    // does not describe the endpoint of this request. Thus the network signal
    // never uses that pattern.
    //
    // With this function, the name of the span has a small number of different
    // values, also when the path contains an id. Without it, the name is the
    // path. In the two conditions, url.full contains the exact target. The code
    // uses a try block, because the code of the host must never cause a failure
    // of fetch.
    let template: string | null | undefined;
    try {
      template = resolveTemplate?.(url);
    } catch {
      template = undefined;
    }
    const name = `${method} ${template ?? path}`;
    const urlFull = url.origin + path;
    const hostname = url.hostname;

    const span = tracer.startSpan(name);
    const { traceId, spanId } = span.spanContext();

    let headers: Headers | undefined;
    if (
      url.origin === location.origin ||
      targets?.some((t) =>
        typeof t === "string" ? url.href.includes(t) : t.test(url.href),
      )
    ) {
      try {
        // The sequence is the same as in fetch: the headers in init replace the
        // headers of a Request object. The code starts from the headers that
        // win, then it adds its own header.
        headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined),
        );
        headers.set("traceparent", `00-${traceId}-${spanId}-01`);
      } catch {
        headers = undefined;
      }
    }

    const end = (status: number | undefined, errorType?: string) => {
      span.setAttributes({
        "http.request.method": method,
        "url.full": urlFull,
        "url.template": template ?? undefined,
        "server.address": hostname,
        "http.response.status_code": status,
        "error.type": errorType,
      });
      // The value 2 is SpanStatusCode.ERROR. An import of the enum adds many
      // bytes to the build.
      if (errorType !== undefined) span.setStatus({ code: 2 });
      span.end();
    };

    let result: Promise<Response>;
    try {
      result = original.call(
        this,
        input,
        headers ? { ...init, headers } : init,
      );
    } catch (e) {
      end(undefined, errorTypeOf(e));
      throw e;
    }
    return result.then(
      (res) => {
        end(res.status, res.status >= 400 ? String(res.status) : undefined);
        return res;
      },
      (e: unknown) => {
        end(undefined, errorTypeOf(e));
        throw e;
      },
    );
  };

  globalThis.fetch = patched;
  return () => {
    if (globalThis.fetch === patched) globalThis.fetch = original;
  };
}
