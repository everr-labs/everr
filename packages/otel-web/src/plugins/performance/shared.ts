import type { AttrValue, Emit } from "../../emitter.js";
import { uniqueId } from "../../session.js";
import type { WebVitalName } from "./index.js";

// The one assembly of a `browser.web_vital` record, shared by webvitals.ts
// (LCP, CLS, TTFB) and inp.ts: the semconv attributes, the rating from the
// per-metric thresholds, the navigation type, and the pinned landing url.
// The metric-specific attribution rides in as pre-named extra attributes.

type Attrs = Record<string, AttrValue | null | undefined>;

// [needs-improvement, poor] boundaries per https://web.dev/articles/vitals.
const THRESHOLDS: Record<WebVitalName, [number, number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  ttfb: [800, 1800],
  inp: [200, 500],
};

// Browsers pin every vital to the initial hard navigation, while the
// envelope's url.* rotate with SPA navigations: the landing url rides each
// record so late reports still slice by the page that was measured.
// Captured at setup (both signals call this at init; the second overwrite
// writes the same values), not at module evaluation, so importing the
// module has no side effect and a consent-flow re-init lands fresh values.
let landingUrl: string;
let landingPath: string;

export function captureLanding(): void {
  landingUrl = location.href;
  landingPath = location.pathname;
}

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
    "everr.landing.url": landingUrl,
    "everr.landing.path": landingPath,
    ...extra,
  });
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
