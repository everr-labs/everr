import type { Instrumentation } from "../runtime.js";
import { startPageviews } from "./pageview.js";

// The pageviews instrumentation: page views on the initial load and each SPA
// navigation, plus one page leave per pageview. The leave rides the hide
// listeners registered here; they run before the client's exit flush
// (instrumentations set up before the client registers its own listeners), and an
// emit while hidden schedules the emitter's coalesced keepalive flush, so
// the final leave always ships.
export function pageviews(): Instrumentation {
  // Named (not an arrow) so sampled() can hash a real identity from
  // instrumentation.name instead of decorrelating nothing.
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
