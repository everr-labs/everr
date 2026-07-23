import type { SessionContext } from "./session.js";

// Navigation watching is envelope infrastructure, not a signal: it always
// runs (regardless of capture flags) so the session's page context stays
// fresh for every signal that emits after an SPA navigation. Signals that
// react to navigations (pageviews today) subscribe as listeners; capture
// flags gate the listeners, never the watcher.

export type NavigationListener = () => void;

export function watchNavigation(
  session: SessionContext,
  listeners: readonly NavigationListener[],
): () => void {
  let lastUrl = window.location.href;
  const onUrlChange = () => {
    const url = window.location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    session.startPageView(url);
    for (const listener of listeners) listener();
  };

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = (...args) => {
    originalPushState(...args);
    onUrlChange();
  };
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    onUrlChange();
  };
  window.addEventListener("popstate", onUrlChange);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", onUrlChange);
  };
}
