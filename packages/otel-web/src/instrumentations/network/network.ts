import type { Tracer } from "@opentelemetry/api";
import { errorTypeOf } from "../../errors.js";
import { requestTemplate } from "../../state/route.js";

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
// cannot copy the headers, it sends no traceparent header. When the caller
// sends a Request object and no headers in init, the code writes the header on
// that Request. Thus the body goes to fetch without a change. The caller can
// see this header on its object, and a fetch of one Request occurs one time.
// The shutdown restores the original fetch only when the global fetch is still
// the function of this module. Thus a module that changed fetch after this
// module wins, and this module wins in the opposite condition.

export type PropagationTarget = string | RegExp;

export function startNetwork(
  tracer: Tracer,
  targets: PropagationTarget[] | undefined,
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
    // The route template of the request, from the `request` route resolver.
    // A server of a different origin must list x-everr-route in its
    // Access-Control-Expose-Headers for the echo below to be readable.
    // The route pattern of the page describes the document, and it does not
    // describe the endpoint of this request. Thus the network signal never
    // uses that pattern.
    //
    // With this function, the name of the span has a small number of different
    // values, also when the path contains an id. Without it, the name is the
    // path. In the two conditions, url.full contains the exact target.
    const template = requestTemplate(url);
    const name = `${method} ${template ?? path}`;
    const urlFull = url.origin + path;
    const hostname = url.hostname;

    const span = tracer.startSpan(name);
    const { traceId, spanId } = span.spanContext();

    // A value here makes an init object for the call below. It stays undefined
    // when the code writes the header on the Request of the caller, and also
    // when the code can set no header. The two conditions send the arguments of
    // the caller without a change, and thus one value serves them.
    let headers: Headers | undefined;
    if (
      url.origin === location.origin ||
      targets?.some((t) =>
        typeof t === "string" ? url.href.includes(t) : t.test(url.href),
      )
    ) {
      try {
        const traceparent = `00-${traceId}-${spanId}-01`;
        // The sequence is the same as in fetch: the headers in init replace the
        // headers of a Request object. Thus a Request whose headers the init
        // replaces takes the second path, because those headers win and they
        // would remove our header.
        //
        // The first path writes the header on the Request of the caller. Thus
        // the code makes no init object. An init object makes fetch build the
        // request again, and a request that has a stream body then needs the
        // `duplex` option. The headers of a Request from a service worker
        // permit no change, and then this throws. The catch below then sends
        // no header.
        if (input instanceof Request && !init?.headers) {
          input.headers.set("traceparent", traceparent);
        } else {
          headers = new Headers(init?.headers);
          headers.set("traceparent", traceparent);
        }
      } catch {
        headers = undefined;
      }
    }

    const end = (
      status: number | undefined,
      errorType?: string,
      echoed?: string | null,
    ) => {
      // A server that stamps its own route on the x-everr-route response
      // header is the exact source: the value is the http.route of the server
      // span, so the two sides of the trace cannot disagree. The header wins
      // over the resolver, and the span takes its final name here, before the
      // end call exports it.
      if (echoed) span.updateName(`${method} ${echoed}`);
      span.setAttributes({
        "http.request.method": method,
        "url.full": urlFull,
        "url.template": echoed ?? template ?? undefined,
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
        end(
          res.status,
          res.status >= 400 ? String(res.status) : undefined,
          res.headers.get("x-everr-route"),
        );
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
