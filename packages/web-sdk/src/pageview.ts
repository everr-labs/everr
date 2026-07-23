import type { Emitter } from "./emitter.js";
import type { NavigationListener } from "./navigation.js";
import type { SessionContext } from "./session.js";

// The pageviews signal: one `browser.page_view` for the hard navigation that
// loaded the page and one per SPA navigation, plus one `browser.page_leave`
// per pageview (on navigation away or page hide) carrying its duration and
// max scroll depth. The navigation watcher rotates the page context before
// listeners run, so the leave overrides the envelope keys that belong to the
// outgoing page.

export type Pageviews = {
  onNavigate: NavigationListener;
  /** Emits the current pageview's leave; at most one per pageview. */
  onHide: () => void;
  stop: () => void;
};

export function startPageviews(
  emitter: Emitter,
  session: SessionContext,
): Pageviews {
  let page = session.current();
  let startedAt = Date.now();
  let maxScrollDepth = 0;
  let leftPageViewId: string | undefined;

  const onScroll = () => {
    const height = document.documentElement.scrollHeight;
    const depth = height ? (scrollY + innerHeight) / height : 0;
    if (depth > maxScrollDepth) maxScrollDepth = Math.min(depth, 1);
  };
  addEventListener("scroll", onScroll, { passive: true });
  // Initial sample: a fully visible page counts even if never scrolled.
  onScroll();

  const emitView = (navigationType: "initial" | "history_change") =>
    emitter.emit("browser.page_view", {
      "everr.navigation.type": navigationType,
    });

  const onHide = () => {
    if (leftPageViewId === page.pageViewId) return;
    leftPageViewId = page.pageViewId;
    emitter.emit("browser.page_leave", {
      // The leave belongs to the page being left: override the envelope.
      "everr.page_view.id": page.pageViewId,
      "url.full": page.url,
      "url.path": page.path,
      "everr.referrer.url": page.referrer,
      "everr.page_view.duration_ms": Date.now() - startedAt,
      "everr.scroll.depth": Math.round(maxScrollDepth * 100) / 100,
    });
  };

  emitView("initial");

  return {
    onNavigate: () => {
      onHide();
      page = session.current();
      startedAt = Date.now();
      maxScrollDepth = 0;
      onScroll();
      emitView("history_change");
    },
    onHide,
    stop: () => removeEventListener("scroll", onScroll),
  };
}
