import type { AttrValue, Emit } from "../../emitter.js";
import { uniqueId } from "../../session.js";
import type { WebVitalName } from "./index.js";

// The one assembly of a `browser.web_vital` record, shared by webvitals.ts
// (LCP, CLS, TTFB) and inp.ts: the semconv attributes, the rating from the
// per-metric thresholds, and the navigation type. The metric-specific
// attribution rides in as pre-named extra attributes. The landing url a
// late vital slices by is `everr.landing.*` on the resource (client.ts).

type Attrs = Record<string, AttrValue | null | undefined>;

// [needs-improvement, poor] boundaries per https://web.dev/articles/vitals.
const THRESHOLDS: Record<WebVitalName, [number, number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  ttfb: [800, 1800],
  inp: [200, 500],
};

export function emitVital(
  emit: Emit,
  name: WebVitalName,
  value: number,
  restored: boolean,
  extra: Attrs,
): void {
  const [ni, poor] = THRESHOLDS[name];
  emit("browser.web_vital", {
    "browser.web_vital.name": name,
    "browser.web_vital.value": value,
    "browser.web_vital.delta": value,
    // At-most-once per metric per navigation epoch, so minting the id at
    // report time is equivalent to minting it at epoch start.
    "browser.web_vital.id": uniqueId(),
    "everr.browser.web_vital.rating":
      value > poor ? "poor" : value > ni ? "needs-improvement" : "good",
    "everr.browser.web_vital.navigation_type": navigationType(restored),
    ...extra,
  });
}

/**
 * The one `<prefix>.script.*` spelling of a LoAF longest-script culprit,
 * shared by the interaction attribution (inp.ts) and the page-load LoAF
 * spans (pageload.ts). The caller picks the duration (intersecting share
 * for interactions, raw script duration for LoAF spans).
 */
export function scriptAttrs(
  prefix: string,
  script: PerformanceScriptTiming,
  duration: number,
): Attrs {
  return {
    [`${prefix}.script.source_url`]: script.sourceURL,
    [`${prefix}.script.function_name`]: script.sourceFunctionName,
    [`${prefix}.script.invoker_type`]: script.invokerType,
    [`${prefix}.script.duration`]: duration,
  };
}

/** The one navigation_type spelling per vital. */
function navigationType(restored: boolean): string {
  return restored
    ? "back-forward-cache"
    : (performance.getEntriesByType("navigation")[0]?.type.replace(/_/g, "-") ??
        "navigate");
}

/**
 * Runs the callback in the next idle period, or immediately if the page is
 * (or becomes) hidden, so pending work never outlives the page. Shared by
 * INP's entry processing and LCP's input-listener finalization.
 */
export function whenIdleOrHidden(cb: () => void): void {
  if (document.visibilityState === "hidden") {
    cb();
    return;
  }
  const rIC = globalThis.requestIdleCallback || setTimeout;
  const cIC = globalThis.cancelIdleCallback || clearTimeout;
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    cb();
  };
  const onHidden = () => {
    cIC(idleHandle as number);
    once();
  };
  addEventListener("visibilitychange", onHidden, { once: true, capture: true });
  const idleHandle = rIC(() => {
    removeEventListener("visibilitychange", onHidden, { capture: true });
    once();
  });
}
