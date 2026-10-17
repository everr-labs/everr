import type { NavigationListener } from "../../navigation.js";
import type { Emit } from "../../pipeline/emitter.js";
import { pageAttrs } from "../../pipeline/envelope.js";
import type { CurrentPage } from "../../state/session.js";

// The pageviews signal. It sends one `everr.browser.page_view` record for the
// full navigation that loaded the page, and one record for each SPA navigation.
// It also sends one `everr.browser.page_leave` record for each page view, when
// the user goes to a different page or when the page becomes hidden. That
// record carries the time on the page.
//
// The navigation watcher makes the new page context before the listeners
// operate. Thus the leave record replaces the envelope with the context of the
// page that the user leaves. It uses the shared `pageAttrs` keys.

type Pageviews = [
  onNavigate: NavigationListener,
  /** Sends the leave record of the current page view. It sends a maximum of one
   * record for each page view. */
  onHide: () => void,
];

export function startPageviews(emit: Emit, current: CurrentPage): Pageviews {
  let page = current();
  let startedAt = Date.now();
  let left = false;

  const emitView = (navigationType: "initial" | "history_change") =>
    emit("everr.browser.page_view", {
      "everr.navigation.type": navigationType,
    });

  const onHide = () => {
    if (left) return;
    left = true;
    emit("everr.browser.page_leave", {
      // The leave record belongs to the page that the user leaves. Thus the
      // code replaces the envelope.
      ...pageAttrs(page),
      "everr.page_view.duration": Date.now() - startedAt,
    });
  };

  emitView("initial");

  return [
    () => {
      onHide();
      page = current();
      startedAt = Date.now();
      left = false;
      emitView("history_change");
    },
    onHide,
  ];
}
