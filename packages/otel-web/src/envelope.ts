import { getAttributes } from "./attributes.js";
import type { AttrValue } from "./emitter.js";
import { routePattern } from "./route.js";
import {
  type CurrentPage,
  type PageContext,
  sessionId,
  visitorId,
} from "./session.js";

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

// The live module state (session, visitor, route, setAttributes ambient set,
// identify()'s user.* keys) is sampled per record, so a change takes effect
// on the very next event; page context is per-client, attribution now rides
// resourceAttributes (client.ts) since it too is fixed for the client's life.
export function createEnvelope(
  current: CurrentPage,
): () => Record<string, AttrValue | null | undefined> {
  return () => ({
    "session.id": sessionId(),
    "everr.visitor.id": visitorId(),
    ...pageAttrs(current()),
    "everr.route.pattern": routePattern(),
    ...getAttributes(),
  });
}
