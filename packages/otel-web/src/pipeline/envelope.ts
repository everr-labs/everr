import { getAttributes } from "../state/attributes.js";
import { routePattern } from "../state/route.js";
import {
  type CurrentPage,
  type PageContext,
  sessionId,
  visitorId,
} from "../state/session.js";
import type { AttrValue } from "./emitter.js";

// The context envelope. The SDK writes it on EACH record that it sends, the
// analytics records and the error records. Thus a query can divide each signal
// by page, and it can connect the signals by session. The attribute names agree
// with the OTel semconv when a convention exists. The other names have the
// `everr.` prefix.

/**
 * The envelope keys for one page. A signal can move a record to a different
 * page, and it uses these keys. For example, page_leave replaces the envelope
 * with the context of the page that the user leaves.
 */
export function pageAttrs(
  page: PageContext,
): Record<string, string | null | undefined> {
  return {
    "everr.page_view.id": page.pageViewId,
    "url.full": page.url,
    "url.path": page.path,
    // The code finds this from the URL of this page. Thus a leave record that
    // moves to the previous page carries the pattern of that page, and not the
    // pattern of the current page.
    "everr.route.pattern": routePattern(page.url),
    "everr.referrer.url": page.referrer,
  };
}

// The code reads the current module data for each record. That data is the
// session, the visitor, the route, the ambient set of setAttributes, and the
// user.* keys from identify(). Thus a change applies to the next event. The
// page context belongs to one client. The resource attributes in client.ts now
// carry the attribution, because it also does not change during the life of the
// client.
export function createEnvelope(
  current: CurrentPage,
): () => Record<string, AttrValue | null | undefined> {
  return () => ({
    "session.id": sessionId(),
    "everr.visitor.id": visitorId(),
    ...pageAttrs(current()),
    ...getAttributes(),
  });
}
