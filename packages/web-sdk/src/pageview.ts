import type { Emitter } from "./emitter.js";
import type { NavigationListener } from "./navigation.js";

// The pageview signal: one `browser.page_view` for the hard navigation that
// loaded the page (emitted immediately), then one per SPA navigation via the
// returned listener. The envelope stamps url/session/pageview context; the
// navigation watcher owns WHEN the page context rotates.

export function startPageviews(emitter: Emitter): NavigationListener {
  const emit = (navigationType: "initial" | "history_change") => {
    emitter.emit("browser.page_view", {
      "everr.navigation.type": navigationType,
    });
  };

  emit("initial");
  return () => emit("history_change");
}
