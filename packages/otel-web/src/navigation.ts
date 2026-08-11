import type { RotatePageView } from "./state/session.js";

// The navigation watcher is part of the envelope, and it is not a signal. It
// always operates, with instrumentations and without them. Thus the page
// context of the session is correct for each signal that the SDK sends after an
// SPA navigation. An instrumentation that must know about a navigation adds a
// listener with ctx.onNavigation. Today only the pageviews instrumentation does
// this.

export type NavigationListener = () => void;

export function watchNavigation(
  rotate: RotatePageView,
  listeners: Iterable<NavigationListener>,
): () => void {
  let lastUrl = location.href;
  const onUrlChange = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    rotate(lastUrl);
    for (const listener of listeners) listener();
  };

  const restores = (["pushState", "replaceState"] as const).map((method) => {
    const original = history[method];
    history[method] = (...args: Parameters<History["pushState"]>) => {
      original.apply(history, args);
      onUrlChange();
    };
    return () => {
      history[method] = original;
    };
  });
  addEventListener("popstate", onUrlChange);

  return () => {
    for (const restore of restores) restore();
    removeEventListener("popstate", onUrlChange);
  };
}
