import {
  type CLSAttribution,
  type FCPAttribution,
  type INPAttribution,
  type LCPAttribution,
  type MetricWithAttribution,
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type TTFBAttribution,
} from "web-vitals/attribution";
import type { AttrValue, Emit } from "./emitter.js";

// The webVitals signal: one `browser.web_vital` record per finalized metric
// (LCP, CLS, INP, FCP, TTFB via the web-vitals v5 attribution build), named
// after the OTel semconv attributes with attribution flattened under the
// same namespace. TTFB and FCP report early and ride normal batches; LCP,
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

// Attribute keys are derived, not written out: `browser.web_vital.<metric>.`
// + the snake_cased attribution field. Listing each field once (instead of a
// camelCase read plus a snake_case key literal) is what keeps this module
// small; the `keyof` constraints keep the lists honest against web-vitals.
const ATTRIBUTION_FIELDS: { [M in MetricWithAttribution["name"]]: string[] } = {
  LCP: [
    "target",
    "url",
    "timeToFirstByte",
    "resourceLoadDelay",
    "resourceLoadDuration",
    "elementRenderDelay",
  ] satisfies (keyof LCPAttribution)[],
  INP: [
    "interactionTarget",
    "interactionType",
    "inputDelay",
    "processingDuration",
    "presentationDelay",
    "loadState",
    "totalScriptDuration",
  ] satisfies (keyof INPAttribution)[],
  CLS: [
    "largestShiftTarget",
    "largestShiftValue",
    "largestShiftTime",
    "loadState",
  ] satisfies (keyof CLSAttribution)[],
  FCP: [
    "timeToFirstByte",
    "firstByteToFCP",
    "loadState",
  ] satisfies (keyof FCPAttribution)[],
  TTFB: [
    "waitingDuration",
    "cacheDuration",
    "dnsDuration",
    "connectionDuration",
    "requestDuration",
  ] satisfies (keyof TTFBAttribution)[],
};

const snakeCase = (field: string) =>
  field.replace(/[A-Z]+/g, (run) => `_${run.toLowerCase()}`);

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
    emit(
      "browser.web_vital",
      {
        "browser.web_vital.name": metric.name.toLowerCase(),
        "browser.web_vital.value": metric.value,
        "browser.web_vital.delta": metric.delta,
        "browser.web_vital.id": metric.id,
        "browser.web_vital.rating": metric.rating,
        "browser.web_vital.navigation_type": metric.navigationType,
        "browser.web_vital.navigation_id": soft.navigationId,
        "browser.web_vital.navigation_url": soft.navigationURL,
        "everr.landing.url": landingUrl,
        "everr.landing.path": landingPath,
        ...attributionAttrs(metric),
      },
      2, // Exit truncation rank: errors > page_leave > vitals > interactions.
    );
  };

  for (const on of [onLCP, onCLS, onINP, onFCP, onTTFB]) on(report);
  // web-vitals has no unsubscribe: stopping silences the callbacks instead.
  return () => {
    stopped = true;
  };
}

function attributionAttrs(metric: MetricWithAttribution): Attrs {
  const prefix = `browser.web_vital.${metric.name.toLowerCase()}.`;
  const attribution = metric.attribution as Record<
    string,
    AttrValue | null | undefined
  >;
  const attrs: Attrs = {};
  for (const field of ATTRIBUTION_FIELDS[metric.name]) {
    attrs[prefix + snakeCase(field)] = attribution[field];
  }
  if (metric.name === "INP") {
    const script = metric.attribution.longestScript?.entry;
    attrs[`${prefix}longest_script_source_url`] = script?.sourceURL;
    attrs[`${prefix}longest_script_function_name`] = script?.sourceFunctionName;
    attrs[`${prefix}longest_script_invoker_type`] = script?.invokerType;
  }
  return attrs;
}
