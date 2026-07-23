import type { Emitter } from "./emitter.js";
import { pageAttrs } from "./envelope.js";
import type { NavigationListener } from "./navigation.js";
import type { SessionContext } from "./session.js";

// The pageviews signal: one `browser.page_view` for the hard navigation that
// loaded the page and one per SPA navigation, plus one `browser.page_leave`
// per pageview (on navigation away or page hide) carrying its duration and
// max scroll depth. The navigation watcher rotates the page context before
// listeners run, so the leave overrides the envelope with the outgoing
// page's context (shared `pageAttrs` keys).

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
  let maxBottom = 0;
  let left = false;

  // Cheap reads only: the layout-forcing scrollHeight is deferred to leave.
  const onScroll = () => {
    const bottom = scrollY + innerHeight;
    if (bottom > maxBottom) maxBottom = bottom;
  };
  addEventListener("scroll", onScroll, { passive: true });
  // Initial sample: a fully visible page counts even if never scrolled.
  onScroll();

  const emitView = (navigationType: "initial" | "history_change") =>
    emitter.emit("browser.page_view", {
      "everr.navigation.type": navigationType,
    });

  const onHide = () => {
    if (left) return;
    left = true;
    const height = document.documentElement.scrollHeight;
    emitter.emit(
      "browser.page_leave",
      {
        // The leave belongs to the page being left: override the envelope.
        ...pageAttrs(page),
        "everr.page_view.duration_ms": Date.now() - startedAt,
        "everr.scroll.depth":
          Math.round(Math.min(height ? maxBottom / height : 0, 1) * 100) / 100,
      },
      1,
    );
  };

  emitView("initial");

  return {
    onNavigate: () => {
      onHide();
      page = session.current();
      startedAt = Date.now();
      maxBottom = 0;
      left = false;
      onScroll();
      emitView("history_change");
    },
    onHide,
    stop: () => removeEventListener("scroll", onScroll),
  };
}
