import type { Instrumentation } from "../runtime.js";
import { startInp } from "./inp.js";
import { startWebVitals } from "./webvitals.js";

export type WebVitalName = "lcp" | "cls" | "ttfb" | "inp";

export type PerformanceOptions = {
  /** The web vitals that the SDK records. The default is all of them. */
  webVitals?: WebVitalName[];
  /** Records the `slow_interaction` spans. The default is true. */
  slowInteractions?: boolean;
};

/**
 * The performance instrumentation. It calculates all the web vitals in this
 * package: LCP, CLS, and TTFB in webvitals.ts, and INP in inp.ts. It also makes
 * the `slow_interaction` spans from the same Event Timing observer that
 * calculates the INP.
 *
 * You can configure each output. The `webVitals` option selects the vitals. The
 * `slowInteractions` option controls the slow spans, and the shared observer
 * operates only when the INP or the slow interactions need it. The capture of
 * the load window is the separate pageLoad instrumentation.
 */
export function performance(options?: PerformanceOptions): Instrumentation {
  const vitals = options?.webVitals ?? ["lcp", "cls", "ttfb", "inp"];
  const slow = options?.slowInteractions ?? true;
  const inp = vitals.includes("inp");
  const classic = vitals.filter((v) => v !== "inp");
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
    return () => {
      stopVitals();
      stopInp?.();
    };
  };
}
