import type { Instrumentation } from "../runtime.js";
import { startPageviews } from "./pageview.js";

// The pageviews instrumentation. It sends a page view for the first load and
// for each SPA navigation. It also sends one page leave for each page view.
//
// The listeners for the hidden state that this module registers send the leave.
// Those listeners operate before the exit flush of the client, because the SDK
// starts the instrumentations before the client registers its own listeners. A
// record that the SDK sends while the page is hidden starts the keepalive flush
// of the emitter, and that flush collects the records. Thus the SDK always
// sends the last leave.
export function pageviews(): Instrumentation {
  // This function has a name and it is not an arrow function. Thus sampled()
  // can make a hash from instrumentation.name, and the decisions for the
  // different instrumentations are different.
  return function pageviews(ctx) {
    const [onNavigate, onHide, stop] = startPageviews(ctx.emit, ctx.page);
    const offNavigation = ctx.onNavigation(onNavigate);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    addEventListener("pagehide", onHide);
    addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      removeEventListener("pagehide", onHide);
      removeEventListener("visibilitychange", onVisibilityChange);
      offNavigation();
      stop();
    };
  };
}
