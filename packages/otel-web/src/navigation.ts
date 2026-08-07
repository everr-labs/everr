import type { RotatePageView } from "./session.js";

// Navigation watching is envelope infrastructure, not a signal: it always
// runs (plugins or not) so the session's page context stays fresh for every
// signal that emits after an SPA navigation. Plugins that react to
// navigations (pageviews today) subscribe as listeners via ctx.onNavigation.

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
