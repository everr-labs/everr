import {
  type MetricWithAttribution,
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
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
  switch (metric.name) {
    case "LCP": {
      const a = metric.attribution;
      return {
        "browser.web_vital.lcp.target": a.target,
        "browser.web_vital.lcp.url": a.url,
        "browser.web_vital.lcp.time_to_first_byte": a.timeToFirstByte,
        "browser.web_vital.lcp.resource_load_delay": a.resourceLoadDelay,
        "browser.web_vital.lcp.resource_load_duration": a.resourceLoadDuration,
        "browser.web_vital.lcp.element_render_delay": a.elementRenderDelay,
      };
    }
    case "INP": {
      const a = metric.attribution;
      const script = a.longestScript?.entry;
      return {
        "browser.web_vital.inp.interaction_target": a.interactionTarget,
        "browser.web_vital.inp.interaction_type": a.interactionType,
        "browser.web_vital.inp.input_delay": a.inputDelay,
        "browser.web_vital.inp.processing_duration": a.processingDuration,
        "browser.web_vital.inp.presentation_delay": a.presentationDelay,
        "browser.web_vital.inp.load_state": a.loadState,
        "browser.web_vital.inp.longest_script_source_url": script?.sourceURL,
        "browser.web_vital.inp.longest_script_function_name":
          script?.sourceFunctionName,
        "browser.web_vital.inp.longest_script_invoker_type":
          script?.invokerType,
        "browser.web_vital.inp.total_script_duration": a.totalScriptDuration,
      };
    }
    case "CLS": {
      const a = metric.attribution;
      return {
        "browser.web_vital.cls.largest_shift_target": a.largestShiftTarget,
        "browser.web_vital.cls.largest_shift_value": a.largestShiftValue,
        "browser.web_vital.cls.largest_shift_time": a.largestShiftTime,
        "browser.web_vital.cls.load_state": a.loadState,
      };
    }
    case "FCP": {
      const a = metric.attribution;
      return {
        "browser.web_vital.fcp.time_to_first_byte": a.timeToFirstByte,
        "browser.web_vital.fcp.first_byte_to_fcp": a.firstByteToFCP,
        "browser.web_vital.fcp.load_state": a.loadState,
      };
    }
    case "TTFB": {
      const a = metric.attribution;
      return {
        "browser.web_vital.ttfb.waiting_duration": a.waitingDuration,
        "browser.web_vital.ttfb.cache_duration": a.cacheDuration,
        "browser.web_vital.ttfb.dns_duration": a.dnsDuration,
        "browser.web_vital.ttfb.connection_duration": a.connectionDuration,
        "browser.web_vital.ttfb.request_duration": a.requestDuration,
      };
    }
  }
}
