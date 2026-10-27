import type { Tracer } from "@opentelemetry/api";
import { notifyRecordingTrigger } from "../../state/clip-trigger.js";
import { requestTemplate } from "../../state/route.js";
import type { PropagationTarget } from "./network.js";

export function shouldPropagate(url: URL, targets?: PropagationTarget[]) {
  return (
    url.origin === location.origin ||
    targets?.some((target) =>
      typeof target === "string" ? url.href.includes(target) : url.href.search(target) !== -1,
    )
  );
}

/** Both transports use the request URL, never the page's route or query. */
export function startRequest(tracer: Tracer, method: string, url: URL) {
  const template = requestTemplate(url);
  const span = tracer.startSpan(`${method} ${template ?? url.pathname}`, {
    kind: 2, // SpanKind.CLIENT. The tracer default is INTERNAL.
  });
  const { traceId, spanId } = span.spanContext();
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    end(this: void, status?: number, errorType?: string, echoed?: string | null) {
      errorType ??= status && status >= 400 ? String(status) : undefined;
      // The server's route echo wins over the client resolver.
      if (echoed) span.updateName(`${method} ${echoed}`);
      span.setAttributes({
        "http.request.method": method,
        "url.full": url.origin + url.pathname,
        "server.address": url.hostname,
        "url.template": echoed ?? template ?? undefined,
        "http.response.status_code": status,
        "error.type": errorType,
      });
      if (errorType !== undefined) span.setStatus({ code: 2 });
      span.end();
      // A 5xx, or a failure that never got a response (fetch reject, XHR
      // error or timeout). A 4xx is not a trigger. An abort is not either:
      // XHR passes no error type, and a fetch abort rejects with AbortError.
      // recording() does not patch fetch; this is the only network seam.
      if (status != null ? status >= 500 : errorType != null && errorType !== "AbortError") {
        notifyRecordingTrigger("network");
      }
    },
  };
}
