import { type Logger, SeverityNumber } from "@opentelemetry/api-logs";
import type { NavigationListener } from "./navigation.js";

// The pageview signal: one `browser.page_view` for the hard navigation that
// loaded the page (emitted immediately), then one per SPA navigation via the
// returned listener. The envelope processor stamps url/session/pageview
// context; the navigation watcher owns WHEN the page context rotates.

export function startPageviews(logger: Logger): NavigationListener {
  const emit = (navigationType: "initial" | "history_change") => {
    logger.emit({
      eventName: "browser.page_view",
      severityNumber: SeverityNumber.INFO,
      attributes: { "everr.navigation.type": navigationType },
    });
  };

  emit("initial");
  return () => emit("history_change");
}
