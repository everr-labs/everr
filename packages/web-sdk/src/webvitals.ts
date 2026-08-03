import {
  type MetricWithAttribution,
  onCLS,
  onINP,
  onLCP,
  onTTFB,
} from "web-vitals/attribution";
import type { AttrValue, Emit } from "./emitter.js";

// The webVitals signal: one `browser.web_vital` record per finalized metric
// (LCP, CLS, INP, FCP, TTFB via the web-vitals v5 attribution build). The
// semconv-defined attributes (name/value/delta/id) keep their bare names;
// everything else, including flattened attribution, is custom and lives
// under `everr.`. TTFB and FCP report early and ride normal batches; LCP,
// CLS and INP mostly report when the page goes hidden, from web-vitals' own
// hidden-state listeners. No vitals-side queue is needed: any record emitted
// while the page is hidden rides the emitter's coalesced exit flush, in
// whatever order the hidden listeners happen to run.
//
// Dedupe is at-most-once per metric id: CLS and INP re-report a grown value
// when a restored tab is hidden again, and re-emitting the same id would
// double-count downstream. Same tradeoff as page_leave: engagement after a
// restore is not re-reported. bfcache restores mint fresh metric ids, so
// those still land as new records.

type Attrs = Record<string, AttrValue | null | undefined>;

export function startWebVitals(emit: Emit): () => void {
  // Browsers pin every vital to the initial hard navigation, while the
  // envelope's url.* rotate with SPA navigations: the landing url rides each
  // record so late reports still slice by the page that was measured.
  const landingUrl = location.href;
  const landingPath = location.pathname;
  const sent = new Set<string>();
  let stopped = false;

  const report = (metric: MetricWithAttribution) => {
    if (stopped || sent.has(metric.id)) return;
    sent.add(metric.id);
    // navigationId/URL appear on the Metric once the Soft Navigations API
    // ships in web-vitals; read defensively so they light up on their own.
    const soft = metric as { navigationId?: string; navigationURL?: string };
    emit("browser.web_vital", {
      "browser.web_vital.name": metric.name.toLowerCase(),
      "browser.web_vital.value": metric.value,
      "browser.web_vital.delta": metric.delta,
      "browser.web_vital.id": metric.id,
      "everr.browser.web_vital.rating": metric.rating,
      "everr.browser.web_vital.navigation_type": metric.navigationType,
      "everr.browser.web_vital.navigation_id": soft.navigationId,
      "everr.browser.web_vital.navigation_url": soft.navigationURL,
      "everr.landing.url": landingUrl,
      "everr.landing.path": landingPath,
      ...attributionAttrs(metric),
    });
  };

  for (const on of [onLCP, onCLS, onINP, onTTFB]) on(report);
  // web-vitals has no unsubscribe: stopping silences the callbacks instead.
  return () => {
    stopped = true;
  };
}

const snake = (s: string) => s.replace(/[A-Z]+/g, (m) => `_${m.toLowerCase()}`);

// Attribution keys are `everr.browser.web_vital.<metric>.` + the web-vitals
// field snake_cased, scalars only (the typeof filter drops PerformanceEntry
// objects, DOM nodes, and entry arrays); fields are auto-derived, so keys
// follow web-vitals upgrades without a code change. INP's longest script is
// the one nested value worth flattening by hand.
function attributionAttrs(metric: MetricWithAttribution): Attrs {
  const prefix = `everr.browser.web_vital.${metric.name.toLowerCase()}.`;
  const attrs: Attrs = {};
  for (const [field, value] of Object.entries(metric.attribution)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      attrs[prefix + snake(field)] = value;
    }
  }
  if (metric.name === "INP") {
    const script = metric.attribution.longestScript?.entry;
    for (const field of [
      "sourceURL",
      "sourceFunctionName",
      "invokerType",
    ] as const) {
      attrs[prefix + snake(`longestScript.${field}`)] = script?.[field];
    }
  }
  return attrs;
}
