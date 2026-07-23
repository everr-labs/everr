import type { SessionContext } from "./session.js";

// The context envelope: stamped on EVERY record emitted through the SDK
// (analytics and, later, errors), which is what lets any signal slice by
// page and join by session. Attribute names follow OTel semconv where a
// convention exists and the `everr.` prefix elsewhere.

export function createEnvelope(
  session: SessionContext,
  attribution: Record<string, string>,
): () => Record<string, string> {
  return () => {
    const page = session.current();
    return {
      "session.id": page.sessionId,
      "everr.page_view.id": page.pageViewId,
      "url.full": page.url,
      "url.path": page.path,
      ...(page.referrer ? { "everr.referrer.url": page.referrer } : {}),
      // The $insert_id analogue: a per-record random id for dedup.
      "everr.event.id": crypto.randomUUID(),
      ...attribution,
    };
  };
}
