import type { Tracer } from "@opentelemetry/api";
import { requestTemplate } from "../../state/route.js";
import type { PropagationTarget } from "./network.js";

export function shouldPropagate(url: URL, targets?: PropagationTarget[]) {
  return (
    url.origin === location.origin ||
    targets?.some((target) =>
      typeof target === "string"
        ? url.href.includes(target)
        : url.href.search(target) !== -1,
    )
  );
}

/** Both transports use the request URL, never the page's route or query. */
export function startRequest(tracer: Tracer, method: string, url: URL) {
  const template = requestTemplate(url);
  const span = tracer.startSpan(`${method} ${template ?? url.pathname}`);
  const { traceId, spanId } = span.spanContext();
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    end(status?: number, errorType?: string, echoed?: string | null) {
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
    },
  };
}
