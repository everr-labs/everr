import type { SessionContext } from "./session.js";

// Navigation watching is envelope infrastructure, not a signal: it always
// runs (regardless of the disable list) so the session's page context stays
// fresh for every signal that emits after an SPA navigation. Signals that
// react to navigations (pageviews today) subscribe as listeners; the disable
// list gates the listeners, never the watcher.

export type NavigationListener = () => void;

export function watchNavigation(
  session: SessionContext,
  listeners: readonly NavigationListener[],
): () => void {
  let lastUrl = location.href;
  const onUrlChange = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    session.startPageView(lastUrl);
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
