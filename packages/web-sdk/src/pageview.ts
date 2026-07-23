import { type Logger, SeverityNumber } from "@opentelemetry/api-logs";
import type { SessionContext } from "./session.js";

// Pageview tracking: one `browser.page_view` for the hard navigation that
// loaded the page, then one per SPA route change via the patched history API
// (pushState, replaceState, popstate), deduped on the full URL. The envelope
// processor stamps url/session/pageview context; this module only decides
// WHEN a pageview happens and rotates the pageview id first.

export function startPageviewTracking(
  logger: Logger,
  session: SessionContext,
): () => void {
  const emit = (navigationType: "initial" | "history_change") => {
    logger.emit({
      eventName: "browser.page_view",
      severityNumber: SeverityNumber.INFO,
      attributes: { "everr.navigation.type": navigationType },
    });
  };

  emit("initial");

  let lastUrl = window.location.href;
  const onUrlChange = () => {
    const url = window.location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    session.startPageView(url);
    emit("history_change");
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
