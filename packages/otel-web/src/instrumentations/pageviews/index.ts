import type { Instrumentation } from "../runtime.js";
import { startPageviews } from "./pageview.js";

// The pageviews instrumentation. It sends a page view for the first load and
// for each SPA navigation. It also sends one page leave for each page view.
//
// The hide listener of this module sends the leave. The SDK calls it before
// the exit flush, and that flush collects the record. Thus the SDK always
// sends the last leave.
export function pageviews(): Instrumentation {
  // This function has a name and it is not an arrow function. Thus sampled()
  // can make a hash from instrumentation.name, and the decisions for the
  // different instrumentations are different.
  return function pageviews(ctx) {
    const [onNavigate, onHide, stop] = startPageviews(ctx.emit, ctx.page);
    const offNavigation = ctx.onNavigation(onNavigate);
    const offHide = ctx.onHide(onHide);
    return () => {
      offHide();
      offNavigation();
      stop();
    };
  };
}
