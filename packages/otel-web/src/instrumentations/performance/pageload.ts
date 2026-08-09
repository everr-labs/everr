/// <reference path="../../dom.d.ts" />
import type { Tracer } from "@opentelemetry/api";
import { scriptAttrs } from "./shared.js";

// The page-load window: one `GET <url>` CLIENT span per static
// resource in the initial load's waterfall (script, css, img, font, link,
// iframe...) from a buffered Resource Timing observer, plus one
// `long_animation_frame` span per main-thread stall from a
// buffered LoAF observer (Chrome 123+), so the waterfall and the jank it
// caused tell one what-was-slow story on the traces timeline, alongside the
// network signal's request spans. fetch/XHR entries are excluded: app
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
// Span timestamps come from the entry itself (timeOrigin + startTime), so
// the trace timeline reproduces the waterfall; the entry's duration is the
// span's, not an attribute. Phase durations are omitted wholesale for
// cross-origin resources without Timing-Allow-Origin, where the browser
// zeroes the detailed timestamps: absent beats fake zeros.

export function startPageLoad(
  tracer: Tracer,
  settleMs: number,
  ceilingMs: number,
): () => void {
  // Entry timestamps are relative to the time origin; spans speak epoch ms.
  // The end is start plus the rounded duration, so the span duration is the
  // entry's regardless of how the fractional start rounded.
  const span = (
    name: string,
    startTime: number,
    duration: number,
    attributes: Record<string, string | number | boolean | undefined>,
  ) => {
    const start = Math.round(performance.timeOrigin + startTime);
    tracer
      .startSpan(name, { startTime: start, attributes })
      .end(start + Math.round(duration));
  };

  const reportAsset = (entry: PerformanceResourceTiming) => {
    const { initiatorType } = entry;
    if (initiatorType === "fetch" || initiatorType === "xmlhttprequest") return;
    let url = entry.name.split("?")[0];
    // Same-origin assets read as paths: the origin is the page's own and
    // only adds noise to every span name; cross-origin (CDN, third-party)
    // keeps the full URL, where the host is the signal.
    if (url.startsWith(`${location.origin}/`))
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
    // HTTP client-span naming, `{method} {target}`: resource fetches are
    // always GETs, and the full query-stripped URL names the exact asset
    // (asset URLs are static, so the name stays queryable).
    span(`GET ${url}`, entry.startTime, entry.duration, {
      "url.full": url,
      "http.response.status_code": responseStatus || undefined,
      "everr.browser.asset.initiator_type": initiatorType,
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

  // One span per long animation frame: where the frame sat in the load
  // timeline and how long it ran are the span's own timestamps. Attributes
  // carry how much of it blocked input, a per-frame category breakdown
  // (script, style-and-layout, unattributed; forced style/layout inside
  // scripts counts as style-and-layout, as DevTools does), and the single
  // longest script (the same script vocabulary slow_interaction spans carry).
  const reportLoaf = (entry: PerformanceLongAnimationFrameTiming) => {
    let longest: PerformanceScriptTiming | undefined;
    let script = 0;
    let forced = 0;
    for (const s of entry.scripts) {
      script += s.duration;
      forced += s.forcedStyleAndLayoutDuration;
      if (!longest || s.duration > longest.duration) longest = s;
    }
    script -= forced;
    // styleAndLayoutStart is 0 when the frame had no style/layout phase.
    const styleAndLayout =
      (entry.styleAndLayoutStart
        ? entry.startTime + entry.duration - entry.styleAndLayoutStart
        : 0) + forced;
    span("long_animation_frame", entry.startTime, entry.duration, {
      "everr.browser.long_animation_frame.blocking_duration": Math.round(
        entry.blockingDuration,
      ),
      "everr.browser.long_animation_frame.script_duration": Math.round(script),
      "everr.browser.long_animation_frame.style_and_layout_duration":
        Math.round(styleAndLayout),
      "everr.browser.long_animation_frame.unattributed_duration": Math.round(
        entry.duration - script - styleAndLayout,
      ),
      ...(longest &&
        scriptAttrs(
          "everr.browser.long_animation_frame",
          longest,
          Math.round(longest.duration),
        )),
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
