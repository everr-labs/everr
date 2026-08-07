/// <reference path="../../dom.d.ts" />
import type { Emit } from "../../emitter.js";

// The page-load window: one `everr.browser.asset` record per static
// resource in the initial load's waterfall (script, css, img, font, link,
// iframe...) from a buffered Resource Timing observer, plus one
// `everr.browser.long_animation_frame` record per main-thread stall from a
// buffered LoAF observer (Chrome 123+), so the waterfall and the jank it
// caused tell one what-was-slow story. fetch/XHR entries are excluded: app
// traffic is the network instrumentation's turf, and emitting both would tell two
// slightly different stories about every request (this also structurally
// keeps the SDK's own telemetry POSTs out, since the emitter ships via
// fetch). Only the loading phase is captured: the observers start at setup
// (buffered, so pre-init entries replay) and stop at `load` + settleMs (the
// grace catches async stragglers) or at ceilingMs from setup, whichever
// comes first. SPA soft navigations never re-open the window.
//
// Attributes follow semconv where it exists (url.full, query-stripped like
// the network span's, because query strings carry tokens and values are
// never captured; http.response.status_code) and live under
// `everr.browser.asset.` / `everr.browser.long_animation_frame.` otherwise.
// Phase durations are omitted wholesale for cross-origin resources without
// Timing-Allow-Origin, where the browser zeroes the detailed timestamps:
// absent beats fake zeros.

export function startPageLoad(
  emit: Emit,
  settleMs: number,
  ceilingMs: number,
): () => void {
  const reportAsset = (entry: PerformanceResourceTiming) => {
    const { initiatorType } = entry;
    if (initiatorType === "fetch" || initiatorType === "xmlhttprequest") return;
    let url = entry.name.split("?")[0];
    // Same-origin assets read as paths: the origin is the page's own and
    // only adds noise to every span name; cross-origin (CDN, third-party)
    // keeps the full URL, where the host is the signal.
    if (url.startsWith(location.origin + "/"))
      url = url.slice(location.origin.length);
    // Newer Resource Timing fields, absent in older engines and lib.dom.
    const { responseStatus, renderBlockingStatus, deliveryType } =
      entry as PerformanceResourceTiming & {
        responseStatus?: number;
        renderBlockingStatus?: string;
        deliveryType?: string;
      };
    // responseStart is 0 when Timing-Allow-Origin withholds the detailed
    // timestamps; every phase below would be a fake zero, so all are omitted.
    const timed = entry.responseStart > 0;
    emit("everr.browser.asset", {
      "url.full": url,
      "http.response.status_code": responseStatus || undefined,
      "everr.browser.asset.initiator_type": initiatorType,
      "everr.browser.asset.duration": Math.round(entry.duration),
      "everr.browser.asset.transfer_size": entry.transferSize,
      "everr.browser.asset.encoded_body_size": entry.encodedBodySize,
      "everr.browser.asset.decoded_body_size": entry.decodedBodySize,
      "everr.browser.asset.render_blocking":
        renderBlockingStatus === "blocking" ? true : undefined,
      "everr.browser.asset.delivery_type": deliveryType || undefined,
      "everr.browser.asset.dns_duration": timed
        ? Math.round(entry.domainLookupEnd - entry.domainLookupStart)
        : undefined,
      "everr.browser.asset.connection_duration": timed
        ? Math.round(entry.connectEnd - entry.connectStart)
        : undefined,
      "everr.browser.asset.tls_duration":
        timed && entry.secureConnectionStart > 0
          ? Math.round(entry.connectEnd - entry.secureConnectionStart)
          : undefined,
      "everr.browser.asset.request_duration": timed
        ? Math.round(entry.responseStart - entry.requestStart)
        : undefined,
      "everr.browser.asset.download_duration": timed
        ? Math.round(entry.responseEnd - entry.responseStart)
        : undefined,
    });
  };

  // One record per long animation frame: where the frame sat in the load
  // timeline, how long it ran, how much of it blocked input, and the single
  // longest script as the actionable culprit (the same script vocabulary
  // slow_interaction records carry).
  const reportLoaf = (entry: PerformanceLongAnimationFrameTiming) => {
    let longest: PerformanceScriptTiming | undefined;
    for (const script of entry.scripts) {
      if (!longest || script.duration > longest.duration) longest = script;
    }
    emit("everr.browser.long_animation_frame", {
      "everr.browser.long_animation_frame.start_time": Math.round(
        entry.startTime,
      ),
      "everr.browser.long_animation_frame.duration": Math.round(entry.duration),
      "everr.browser.long_animation_frame.blocking_duration": Math.round(
        entry.blockingDuration,
      ),
      "everr.browser.long_animation_frame.script.source_url":
        longest?.sourceURL,
      "everr.browser.long_animation_frame.script.function_name":
        longest?.sourceFunctionName,
      "everr.browser.long_animation_frame.script.invoker_type":
        longest?.invokerType,
      "everr.browser.long_animation_frame.script.duration":
        longest && Math.round(longest.duration),
    });
  };

  const po = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      reportAsset(entry as PerformanceResourceTiming);
  });
  po.observe({ type: "resource", buffered: true });

  let loafPo: PerformanceObserver | undefined;
  try {
    loafPo = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        reportLoaf(entry as PerformanceLongAnimationFrameTiming);
    });
    loafPo.observe({ type: "long-animation-frame", buffered: true });
  } catch {
    // LoAF is Chrome 123+: elsewhere the waterfall ships alone.
  }

  let settle: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    po.disconnect();
    loafPo?.disconnect();
    clearTimeout(settle);
    clearTimeout(ceiling);
    removeEventListener("load", onLoad);
  };
  const onLoad = () => {
    settle = setTimeout(stop, settleMs);
  };
  const ceiling = setTimeout(stop, ceilingMs);
  if (document.readyState === "complete") onLoad();
  else addEventListener("load", onLoad);

  return stop;
}
