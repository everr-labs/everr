import type { Plugin } from "../runtime.js";
import { startInp } from "./inp.js";
import { startWebVitals } from "./webvitals.js";

/**
 * The performance plugin: web vitals (LCP, CLS, TTFB via the web-vitals
 * dependency, which ships inside this plugin so it tree-shakes with it, and
 * INP computed in-house) plus `everr.browser.slow_interaction` records from
 * the same Event Timing observer that computes INP.
 */
export function performance(): Plugin {
  return {
    name: "performance",
    setup: (ctx) => {
      const stopVitals = startWebVitals(ctx.emit);
      const stopInp = startInp(ctx.emit);
      return () => {
        stopVitals();
        stopInp();
      };
    },
  };
}
