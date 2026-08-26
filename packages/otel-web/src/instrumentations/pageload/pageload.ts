/// <reference path="../../dom.d.ts" />
import type { Tracer } from "@opentelemetry/api";
import { childOf } from "../../pipeline/tracer.js";
import { scriptAttrs } from "../performance/shared.js";

// The window of the page load. The code makes one `PageLoad` root span for the
// trace of the load. It starts at the time origin of the document, and it ends
// at the LCP: the start of the most recent largest-contentful-paint entry. The
// spans below are its children. Thus the trace timeline shows the resources
// and the delays before the largest paint, in one trace. A browser without LCP
// ends the root at the end of the `load` event.
//
// A Resource Timing observer with the buffered option gives the entries, and
// the code makes one `pageLoad.asset.<initiator_type>` CLIENT span for each
// static resource in the first load: a script, a CSS file, an image, a font, a
// link, an iframe, and the equivalent resources. A LoAF observer with the
// buffered option gives the long animation frames, and the code makes one
// `long_animation_frame` span for each interval when the main thread stops.
// Chrome 123 and the later versions have that observer. Thus the sequence of
// the resources and the delays that they caused give one description of the
// slow operations on the trace timeline, with the request spans of the network
// signal.
//
// The code ignores the fetch entries and the XHR entries. The network
// instrumentation captures the traffic of the app. Two records for one request
// give two slightly different descriptions. This also keeps the telemetry POST
// operations of the SDK out of this signal, because the emitter uses fetch.
//
// The code captures only the load phase. The observers start at the setup with
// the buffered option, and thus they also give the entries from before the
// setup. They stop at the `load` event plus settleMs, which gets the resources
// that load late, or at ceilingMs from the setup. The first of the two events
// stops them, and the SDK then sends the root span. The root also goes out
// when the page becomes hidden, because a user who leaves before the window
// stops must not leave the children without their root. A resource after the
// LCP is a child that ends after its parent, and that is correct: the root
// gives the interval to the largest paint, and the window gives the resources.
// An SPA navigation never opens this window again.
//
// The attributes agree with the semconv when it gives a name. The url.full
// attribute has no query string, the same as in a network span, because a query
// string can contain a token and the SDK never captures a value. The semconv
// also gives http.response.status_code. The other attributes have the
// `everr.browser.asset.` prefix or the `everr.browser.long_animation_frame.`
// prefix.
//
// The timestamps of a span come from the entry, as timeOrigin plus startTime.
// Thus the trace timeline shows the true sequence of the resources. The
// duration of the entry is the duration of the span, and it is not an
// attribute.
//
// A resource of a different origin without the Timing-Allow-Origin header has
// no detailed timestamps, because the browser makes them zero. For such a
// resource the code writes no phase duration, because an absent value is better
// than an incorrect zero.

export function startPageLoad(
  tracer: Tracer,
  settleMs: number,
  ceilingMs: number,
): () => void {
  // The timestamps of an entry are relative to the time origin, but a span uses
  // milliseconds from the epoch.
  const epoch = (time: number) => Math.round(performance.timeOrigin + time);
  const root = tracer.startSpan("PageLoad", { startTime: epoch(0) });
  const inRoot = childOf(root);
  // The end is the start plus the duration after the code rounds it. Thus the
  // duration of the span is the duration of the entry, and the rounding of the
  // start does not change it.
  const span = (
    name: string,
    startTime: number,
    duration: number,
    attributes: Record<string, string | number | boolean | undefined>,
  ) => {
    const start = epoch(startTime);
    tracer
      .startSpan(name, { startTime: start, attributes }, inRoot)
      .end(start + Math.round(duration));
  };

  const reportAsset = (entry: PerformanceResourceTiming) => {
    const { initiatorType } = entry;
    if (initiatorType === "fetch" || initiatorType === "xmlhttprequest") return;
    let url = entry.name.split("?")[0];
    // A resource of the same origin uses its path. The origin is the origin of
    // the page, and it adds no information to the name of a span. A resource of
    // a different origin, for example from a CDN or a third party, keeps the
    // full URL, because the host is the important data.
    if (url.startsWith(`${location.origin}/`))
      url = url.slice(location.origin.length);
    // These Resource Timing fields are new. An old browser does not have them,
    // and lib.dom does not declare them.
    const { responseStatus, renderBlockingStatus, deliveryType } =
      entry as PerformanceResourceTiming & {
        responseStatus?: number;
        renderBlockingStatus?: string;
        deliveryType?: string;
      };
    // The value of responseStart is 0 when the Timing-Allow-Origin header does
    // not permit the detailed timestamps. Then each phase below is an incorrect
    // zero. Thus the code writes none of them.
    const timed = entry.responseStart > 0;
    // The name has the initiator type and not the URL, for example
    // `pageLoad.asset.script`. A URL frequently has a hash of the content, and
    // a name with the URL changes at each deployment. A name from the type is
    // the same for each load, and thus a query can group the spans by name.
    // The url.full attribute gives the exact resource.
    span(`pageLoad.asset.${initiatorType}`, entry.startTime, entry.duration, {
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

  // One span for each long animation frame. The timestamps of the span give the
  // position of the frame in the load timeline and its duration. The attributes
  // give the interval that the frame prevented an input. They also give the
  // duration of each category in the frame: the script, the style and the
  // layout, and the part without a category. A forced style operation or a
  // forced layout operation inside a script counts as style and layout, the
  // same as in DevTools. The attributes also give the longest script, and they
  // use the same names as the slow_interaction spans.
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
    // The same calculation as the web-vitals attribution: the style and the
    // layout go from styleAndLayoutStart to the end of the frame. Thus the
    // spans and the INP attribution in inp.ts give the same numbers for the
    // same frame.
    const styleAndLayout =
      entry.startTime + entry.duration - entry.styleAndLayoutStart + forced;
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
    // Chrome 123 and the later versions have LoAF. In a different browser, the
    // SDK sends only the resource spans.
  }

  // The LCP candidate. The browser sends a new entry each time a larger
  // element paints, and the most recent entry is the LCP. The code keeps only
  // its time, and it does not complete the value at an input, different from
  // the LCP vital: this span gives the interval on the timeline, and the vital
  // gives the metric.
  let lcp = 0;
  let lcpPo: PerformanceObserver | undefined;
  const takeLcp = (entries: PerformanceEntry[]) => {
    for (const entry of entries) lcp = entry.startTime;
  };
  // Ends the root one time. The entries that the observer did not deliver
  // yet come first. Without an LCP and before the load event, the root ends
  // now.
  const endRoot = () => {
    if (lcpPo) takeLcp(lcpPo.takeRecords());
    const end =
      lcp || performance.getEntriesByType("navigation")[0]?.loadEventEnd;
    root.end(end ? epoch(end) : undefined);
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") endRoot();
  };
  try {
    lcpPo = new PerformanceObserver((list) => takeLcp(list.getEntries()));
    lcpPo.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // A browser without LCP. The root ends at the load event.
  }
  let settle: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    endRoot();
    po.disconnect();
    loafPo?.disconnect();
    lcpPo?.disconnect();
    clearTimeout(settle);
    clearTimeout(ceiling);
    removeEventListener("load", onLoad);
    removeEventListener("pagehide", endRoot);
    removeEventListener("visibilitychange", onHide);
  };
  // The same two events as the exit flush of the SDK. This listener registers
  // before that flush, and thus the root is in the batch that the flush sends.
  addEventListener("pagehide", endRoot);
  addEventListener("visibilitychange", onHide);
  const onLoad = () => {
    settle = setTimeout(stop, settleMs);
  };
  const ceiling = setTimeout(stop, ceilingMs);
  if (document.readyState === "complete") onLoad();
  else addEventListener("load", onLoad);

  return stop;
}
