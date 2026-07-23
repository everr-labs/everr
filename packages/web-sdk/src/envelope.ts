import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";
import type { SessionContext } from "./session.js";

// The context envelope: stamped on EVERY log record emitted through the SDK's
// provider (analytics and, later, errors), which is what lets any signal
// slice by page and join by session. Attribute names follow OTel semconv
// where a convention exists and the `everr.` prefix elsewhere.

export function createEnvelopeProcessor(
  session: SessionContext,
  attribution: Record<string, string>,
): LogRecordProcessor {
  return {
    onEmit(logRecord: SdkLogRecord): void {
      const page = session.current();
      logRecord.setAttribute("session.id", page.sessionId);
      logRecord.setAttribute("everr.page_view.id", page.pageViewId);
      logRecord.setAttribute("url.full", page.url);
      logRecord.setAttribute("url.path", pathOf(page.url));
      if (page.referrer) {
        logRecord.setAttribute("everr.referrer.url", page.referrer);
      }
      // The $insert_id analogue: a per-record random id for dedup.
      logRecord.setAttribute("everr.event.id", crypto.randomUUID());
      for (const [key, value] of Object.entries(attribution)) {
        logRecord.setAttribute(key, value);
      }
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
