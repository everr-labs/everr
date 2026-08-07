import type { Tracer } from "@opentelemetry/api";
import { errorTypeOf } from "../../errors.js";
import { routePattern } from "../../route.js";

// The network signal: window.fetch is patched so every request (1) becomes
// an OTel CLIENT span on the traces pipeline and (2) carries a W3C
// traceparent header where propagation is safe, making the browser request
// the root of the distributed trace the server's spans parent to.
//
// Propagation is same-origin by default: a traceparent on a cross-origin
// request triggers a CORS preflight and fails unless the target server
// allows the header, so cross-origin backends must be named in the
// `tracePropagationTargets` option (string = substring match on the
// full URL, or RegExp). Spans are recorded for every request regardless;
// the option gates only the header.
//
// Spans ride the SDK's Tracer (the same one instrumentations get): each request is
// its own always-sampled trace, and its ids feed the traceparent header;
// pageview/session grouping rides the envelope attrs stamped on the span.
// The SDK's own telemetry POSTs never reach this patch: the emitter captured
// the fetch reference before the patch was applied, so a
// span-of-our-own-batch loop is structurally impossible. Attributes follow
// HTTP client-span semconv; per semconv, url.full on a client span is the
// REQUEST url (the envelope's page-context url.* is overridden by design),
// deliberately query-stripped: query strings carry tokens and PII, and the
// structural privacy stance is to never capture values. 4xx and 5xx both
// mark the span as error.
//
// The patch must never break the page: an unparseable URL falls through to
// the original fetch with the arguments untouched, a failing header clone
// downgrades to no propagation, and shutdown restores the original only if
// the global is still ours (a later patcher wins, exactly as we would want
// an earlier one to let us win).

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
    // Read the URL parts once: the completion closure captures plain
    // strings, not the URL host object.
    const path = url.pathname;
    // Low-cardinality span name: the page's route pattern (the same
    // dimension the envelope's everr.route.pattern slices by) rather than
    // the request path, whose ids would mint a span name per entity. The
    // exact target stays on url.full.
    const name = `${method} ${routePattern() ?? path}`;
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
        // Precedence mirrors fetch itself: init.headers override a Request
        // input's headers; we start from whichever wins and add ours.
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
        "server.address": hostname,
        "http.response.status_code": status,
        "error.type": errorType,
      });
      // 2 is SpanStatusCode.ERROR; the enum import would cost real bytes.
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
