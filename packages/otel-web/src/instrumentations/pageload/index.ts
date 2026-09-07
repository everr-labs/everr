import type { Instrumentation } from "../runtime.js";
import { startPageLoad } from "./pageload.js";

export type PageLoadOptions = {
  /**
   * The interval after the `load` event before the capture stops. Thus the SDK
   * also gets the resources that load late, for example a late script or a
   * font that loads on demand. The default is 3000.
   */
  settleMs?: number;
  /**
   * The maximum interval in milliseconds from the setup. It stops the capture
   * on a page where the `load` event does not occur. The default is 10000.
   */
  ceilingMs?: number;
};

/**
 * The pageLoad instrumentation. It captures the first load of the page. The
 * SDK makes one `pageLoad` root span from the time origin to the LCP. Each
 * span of the SDK that starts before that end is its child, for example a
 * request span of `network()`. The instrumentation also makes one
 * `pageLoad.asset.<initiator_type>` child span for each static resource, for
 * example a script, a CSS file, an image, or a font, and one
 * `pageLoad.long_animation_frame` child span for each interval when the main
 * thread stops in the same window. An SPA navigation never opens this window
 * again.
 *
 * To record a part of the sessions, use `sampled(pageLoad(), rate)`. A session
 * then records all this data or none of it, in all the tabs and after a
 * reload.
 */
export function pageLoad(options?: PageLoadOptions): Instrumentation {
  // This function has a name and it is not an arrow function. Thus sampled()
  // can make a hash from instrumentation.name, and the decisions for the
  // different instrumentations are different.
  return function pageLoad(ctx) {
    return startPageLoad(
      ctx.tracer,
      ctx.onHide,
      options?.settleMs ?? 3000,
      options?.ceilingMs ?? 10000,
    );
  };
}
