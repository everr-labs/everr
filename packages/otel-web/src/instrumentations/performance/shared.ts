import type { AttrValue, Emit } from "../../emitter.js";
import { uniqueId } from "../../session.js";
import type { WebVitalName } from "./index.js";

// The one function that makes a `browser.web_vital` record. The webvitals.ts
// module uses it for LCP, CLS, and TTFB, and inp.ts uses it for INP. The record
// contains the semconv attributes, the rating from the limits of that metric,
// and the navigation type. The caller sends the attribution of the metric as
// additional attributes with their final names. A vital that the SDK sends late
// uses the landing url, and the resource attributes in client.ts carry that url
// as `everr.landing.*`.

type Attrs = Record<string, AttrValue | null | undefined>;

// The limits for the ratings "needs-improvement" and "poor". They come from
// https://web.dev/articles/vitals.
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
    // The SDK sends a maximum of one record for each metric in each navigation
    // period. Thus the code can make the id when it sends the record, and the
    // result is the same as an id that it makes at the start of the period.
    "browser.web_vital.id": uniqueId(),
    "everr.browser.web_vital.rating":
      value > poor ? "poor" : value > ni ? "needs-improvement" : "good",
    "everr.browser.web_vital.navigation_type": navigationType(restored),
    ...extra,
  });
}

/**
 * The one method to write the `<prefix>.script.*` attributes for the longest
 * script in a LoAF. The attribution of an interaction in inp.ts uses it, and the
 * LoAF spans of the page load in pageload.ts use it also. The caller selects the
 * duration: for an interaction it is the part that is in the interaction, and
 * for a LoAF span it is the full duration of the script.
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

/** The one method to write the navigation_type value for each vital. */
function navigationType(restored: boolean): string {
  return restored
    ? "back-forward-cache"
    : (performance.getEntriesByType("navigation")[0]?.type.replace(/_/g, "-") ??
        "navigate");
}

/**
 * Calls the function in the next idle period. If the page is hidden, or if it
 * becomes hidden, the code calls the function immediately. Thus the work always
 * ends before the page ends. The processing of the INP entries uses this
 * function, and the input listener of the LCP uses it also.
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
