import type { PageContext, SessionContext } from "./session.js";

// The context envelope: stamped on EVERY record emitted through the SDK
// (analytics and, later, errors), which is what lets any signal slice by
// page and join by session. Attribute names follow OTel semconv where a
// convention exists and the `everr.` prefix elsewhere.

/**
 * The page-scoped envelope keys, shared with signals that re-point a record
 * at a specific page (page_leave overrides the envelope with the outgoing
 * page's context via these same keys).
 */
export function pageAttrs(
  page: PageContext,
): Record<string, string | undefined> {
  return {
    "everr.page_view.id": page.pageViewId,
    "url.full": page.url,
    "url.path": page.path,
    "everr.referrer.url": page.referrer,
  };
}

export function createEnvelope(
  session: SessionContext,
  attribution: Record<string, string>,
): () => Record<string, string | undefined> {
  return () => {
    const page = session.current();
    return {
      "session.id": page.sessionId,
      ...pageAttrs(page),
      // The $insert_id analogue: a per-record random id for dedup.
      "everr.event.id": crypto.randomUUID(),
      ...attribution,
    };
  };
}
