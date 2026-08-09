import type { Instrumentation } from "../runtime.js";
import { hashUnit } from "../sampled.js";
import { startInp } from "./inp.js";
import { startPageLoad } from "./pageload.js";
import { startWebVitals } from "./webvitals.js";

export type WebVitalName = "lcp" | "cls" | "ttfb" | "inp";

export type PageLoadOptions = {
  /**
   * Grace after the `load` event before capture stops, so async stragglers
   * (late scripts, lazy fonts) still land. Default 3000.
   */
  settleMs?: number;
  /**
   * Hard stop, in ms from setup, for pages whose `load` never fires.
   * Default 10000.
   */
  ceilingMs?: number;
  /**
   * Session-sampled rate in [0, 1] for the whole load window (waterfall and
   * long animation frames together; the vitals are never sampled). Decided
   * once at setup from the session id, so a session is all-in or all-out
   * across tabs and reloads. Default 1.
   */
  sample?: number;
};

export type PerformanceOptions = {
  /** Which web vitals to record. Default: all of them. */
  webVitals?: WebVitalName[];
  /** Record `slow_interaction` spans. Default true. */
  slowInteractions?: boolean;
  /**
   * Capture the initial page load: the static-resource waterfall (one
   * `GET <url>` span per script/css/img/font...) plus one
   * `long_animation_frame` span per main-thread stall in
   * the same window. On by default; `false` turns it off, an options
   * object tunes the window and sampling.
   */
  pageLoad?: boolean | PageLoadOptions;
};

/**
 * The performance instrumentation: web vitals, all computed in-house (LCP, CLS, TTFB
 * in webvitals.ts, INP in inp.ts) plus `slow_interaction` spans
 * from the same Event Timing observer that computes INP, and the
 * on-by-default page-load capture (pageload.ts). All outputs are configurable:
 * `webVitals` picks the vitals, `slowInteractions` gates the slow spans
 * (the shared observer runs only while at least one of INP or slow
 * interactions wants it), `pageLoad: false` closes the load window.
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
  // Named (not an arrow) so sampled() can hash a real identity from
  // instrumentation.name instead of decorrelating nothing.
  return function performance(ctx) {
    // startWebVitals with an empty list registers nothing; the inp/slow
    // guard is load-bearing (it keeps the Event Timing observer off).
    const stopVitals = startWebVitals(ctx.emit, classic);
    const stopInp =
      inp || slow ? startInp(ctx.emit, ctx.tracer, inp, slow) : undefined;
    // The sample decision mirrors sampled(): hashed from the session id at
    // setup, decorrelated from whole-instrumentation sampling by its own suffix.
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
