import type { AttrValue } from "./emitter.js";
import type { CurrentPage, PageContext } from "./session.js";

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
  current: CurrentPage,
  attribution: Record<string, string>,
  /**
   * Identity attributes (visitor id, identified user), sampled per record
   * so identify() takes effect on the very next event.
   */
  identity: () => Record<string, AttrValue>,
  /** Host-supplied low-cardinality route pattern, sampled per record. */
  routePattern?: () => string | null | undefined,
): () => Record<string, AttrValue | null | undefined> {
  return () => {
    const page = current();
    return {
      "session.id": page.sessionId,
      ...pageAttrs(page),
      "everr.route.pattern": guarded(routePattern),
      ...identity(),
      ...attribution,
    };
  };
}

function guarded(fn: (() => string | null | undefined) | undefined) {
  // The host callback must never break capture.
  try {
    return fn?.();
  } catch {
    return undefined;
  }
}
