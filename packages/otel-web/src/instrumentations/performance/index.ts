import type { Instrumentation } from "../runtime.js";
import { hashUnit } from "../sampled.js";
import { startInp } from "./inp.js";
import { startPageLoad } from "./pageload.js";
import { startWebVitals } from "./webvitals.js";

export type WebVitalName = "lcp" | "cls" | "ttfb" | "inp";

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
  /**
   * The part of the sessions that the SDK records, from 0 to 1. It applies to
   * the full load window: the resource spans and the long animation frames
   * together. The SDK always records the vitals.
   *
   * The code decides one time at the setup, from the session id. Thus a session
   * records all this data or none of it, in all the tabs and after a reload.
   * The default is 1.
   */
  sample?: number;
};

export type PerformanceOptions = {
  /** The web vitals that the SDK records. The default is all of them. */
  webVitals?: WebVitalName[];
  /** Records the `slow_interaction` spans. The default is true. */
  slowInteractions?: boolean;
  /**
   * Captures the first load of the page. The SDK makes one `GET <url>` span for
   * each static resource, for example a script, a CSS file, an image, or a
   * font. It also makes one `long_animation_frame` span for each interval when
   * the main thread stops in the same window.
   *
   * This option is on by default. A value of `false` stops it. An options object
   * changes the window and the sampling.
   */
  pageLoad?: boolean | PageLoadOptions;
};

/**
 * The performance instrumentation. It calculates all the web vitals in this
 * package: LCP, CLS, and TTFB in webvitals.ts, and INP in inp.ts. It also makes
 * the `slow_interaction` spans from the same Event Timing observer that
 * calculates the INP. It also captures the page load, in pageload.ts, and that
 * capture is on by default.
 *
 * You can configure each output. The `webVitals` option selects the vitals. The
 * `slowInteractions` option controls the slow spans, and the shared observer
 * operates only when the INP or the slow interactions need it. The value
 * `pageLoad: false` stops the capture of the load window.
 */
export function performance(options?: PerformanceOptions): Instrumentation {
  const vitals = options?.webVitals ?? ["lcp", "cls", "ttfb", "inp"];
  const slow = options?.slowInteractions ?? true;
  const inp = vitals.includes("inp");
  const classic = vitals.filter((v) => v !== "inp");
  const pageLoad =
    options?.pageLoad === false
      ? undefined
      : options?.pageLoad === true || options?.pageLoad === undefined
        ? {}
        : options.pageLoad;
  // This function has a name and it is not an arrow function. Thus sampled()
  // can make a hash from instrumentation.name, and the decisions for the
  // different instrumentations are different.
  return function performance(ctx) {
    // With an empty list, startWebVitals registers nothing. The test for the
    // INP and the slow interactions is necessary, because it keeps the Event
    // Timing observer off.
    const stopVitals = startWebVitals(ctx.emit, classic);
    const stopInp =
      inp || slow ? startInp(ctx.emit, ctx.tracer, inp, slow) : undefined;
    // This decision uses the same method as sampled(). The code makes a hash
    // from the session id at the setup. It adds its own text to that hash. Thus
    // this decision is different from the decision for the full
    // instrumentation.
    const sample = pageLoad?.sample ?? 1;
    const stopPageLoad =
      pageLoad &&
      sample > 0 &&
      (sample >= 1 || hashUnit(`${ctx.ids().sessionId}:pageLoad`) < sample)
        ? startPageLoad(
            ctx.tracer,
            pageLoad.settleMs ?? 3000,
            pageLoad.ceilingMs ?? 10000,
          )
        : undefined;
    return () => {
      stopVitals();
      stopInp?.();
      stopPageLoad?.();
    };
  };
}
