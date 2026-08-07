/// <reference path="../../dom.d.ts" />
import { selectorOf } from "../../element.js";
import type { AttrValue, Emit } from "../../emitter.js";
import type { WebVitalName } from "./index.js";
import { captureLanding, emitVital, whenIdleOrHidden } from "./shared.js";

// The classic web vitals (LCP, CLS, TTFB), computed in-house: one
// `browser.web_vital` record per metric per navigation epoch, with the
// attribution the web-vitals attribution build would have derived flattened
// under `everr.browser.web_vital.<metric>.`. The semconv-defined attributes
// (name/value/delta/id) keep their bare names. TTFB reports on load and
// rides normal batches; LCP and CLS report when the page first goes hidden
// (or, for LCP, on the first keyboard/click input), and any record emitted
// while hidden rides the emitter's coalesced exit flush. INP lives in
// inp.ts, sharing the Event Timing observer with slow-interaction records.
//
// The measurement core (the LCP first-input/hidden finalization, the CLS
// 1s-gap/5s-cap session windowing, the TTFB navigation-entry subparts, the
// LCP resource-timing phase breakdown, and the first-hidden gating) is
// ported and adapted from the GoogleChrome/web-vitals library
// (https://github.com/GoogleChrome/web-vitals, copyright Google LLC, Apache
// License 2.0).
//
// Deliberate divergences from web-vitals, each traded for bundle size:
//
// - Reports are at-most-once per metric per navigation epoch (the previous
//   dedupe-by-metric-id dropped web-vitals' grown-CLS re-reports anyway, so
//   the wire behavior is unchanged); delta therefore always equals value.
// - CLS's FCP gate reads the buffered paint entry at report time instead of
//   running a paint observer (web-vitals gates CLS on FCP to match CrUX).
// - Prerender refinements are skipped, same as inp.ts: activationStart
//   still offsets values, but visibility tracking ignores `prerendering`
//   and navigation_type never reports "prerender"/"restore".
// - Attribution targets use the shared selectorOf spelling (the same
//   `everr.element.selector` path vocabulary), not web-vitals' class-based
//   selectors.

type Attrs = Record<string, AttrValue | null | undefined>;
type Classic = Exclude<WebVitalName, "inp">;

/** The navigation entry, when its responseStart is usable (web-vitals'
 * validity check: zero for privacy, negative or future from browser bugs). */
function navEntry(): PerformanceNavigationTiming | undefined {
  const e = performance.getEntriesByType("navigation")[0];
  return e && e.responseStart > 0 && e.responseStart < performance.now()
    ? e
    : undefined;
}

const activationStart = () => navEntry()?.activationStart || 0;

/** The document phase a timestamp fell in, for the CLS load_state attr. */
function loadStateAt(time: number): string {
  if (document.readyState === "loading") return "loading";
  const nav = navEntry();
  if (nav) {
    if (time < nav.domInteractive) return "loading";
    if (
      !nav.domContentLoadedEventStart ||
      time < nav.domContentLoadedEventStart
    )
      return "dom-interactive";
    if (!nav.domComplete || time < nav.domComplete) return "dom-content-loaded";
  }
  return "complete";
}

export function startWebVitals(emit: Emit, vitals: Classic[]): () => void {
  if (!vitals.length) return () => {};

  captureLanding();
  let stopped = false;
  let restored = false;

  const report = (name: Classic, value: number, attribution: Attrs) => {
    if (stopped) return;
    const extra: Attrs = {};
    for (const [key, v] of Object.entries(attribution)) {
      extra[`everr.browser.web_vital.${name}.${key}`] = v;
    }
    emitVital(emit, name, value, restored, extra);
  };

  // The first time the page was hidden, page-lifetime: entries painted after
  // it never count (a background-loaded tab reports no LCP at all). Prefer
  // the buffered visibility-state entry (Chrome) over the load-time check.
  let firstHidden = document.visibilityState === "hidden" ? 0 : Infinity;
  const hiddenEntry = performance
    .getEntriesByType("visibility-state")
    .find((e) => e.name === "hidden");
  if (hiddenEntry) firstHidden = hiddenEntry.startTime;

  // --- TTFB: navigation-entry subparts, reported after load so the entry
  // is fully populated ---
  const reportTtfb = () => {
    if (stopped) return;
    const nav = navEntry();
    if (!nav) return;
    const start = nav.activationStart || 0;
    const value = Math.max(nav.responseStart - start, 0);
    // Measured from workerStart or fetchStart so service worker startup
    // lands in cache_duration; the connectEnd..requestStart gap lands in
    // request_duration so connection_duration stays 0 under service workers.
    const waitEnd = Math.max((nav.workerStart || nav.fetchStart) - start, 0);
    const dnsStart = Math.max(nav.domainLookupStart - start, 0);
    const connectStart = Math.max(nav.connectStart - start, 0);
    const connectEnd = Math.max(nav.connectEnd - start, 0);
    report("ttfb", value, {
      waiting_duration: waitEnd,
      cache_duration: dnsStart - waitEnd,
      dns_duration: connectStart - dnsStart,
      connection_duration: connectEnd - connectStart,
      request_duration: value - connectEnd,
    });
  };
  const onLoad = () => setTimeout(reportTtfb);
  if (vitals.includes("ttfb")) {
    if (document.readyState === "complete") setTimeout(reportTtfb);
    else addEventListener("load", onLoad, { once: true, capture: true });
  }

  // --- LCP: the latest qualifying largest-contentful-paint entry,
  // finalized on the first keyboard/click input or on hidden ---
  type LcpCandidate = { startTime: number; url: string; target?: string };
  let lcp: LcpCandidate | undefined;
  let lcpDone = !vitals.includes("lcp");
  let lcpPo: PerformanceObserver | undefined;

  const handleLcpEntries = (entries: PerformanceEntry[]) => {
    for (const entry of entries as LargestContentfulPaint[]) {
      if (entry.startTime >= firstHidden) continue;
      lcp = {
        startTime: entry.startTime,
        url: entry.url,
        // Captured eagerly: the element can leave the DOM (or lose identity)
        // long before the report finalizes on input or hidden. When it is
        // already gone but carried an id, the id still names it.
        target: entry.element
          ? selectorOf(entry.element)
          : entry.id
            ? `#${entry.id}`
            : undefined,
      };
    }
  };

  const finalizeLcp = () => {
    if (lcpDone || stopped || !lcpPo) return;
    lcpDone = true;
    handleLcpEntries(lcpPo.takeRecords());
    lcpPo.disconnect();
    if (!lcp) return;
    const start = activationStart();
    const value = Math.max(lcp.startTime - start, 0);
    const attribution: Attrs = {
      target: lcp.target,
      url: lcp.url || undefined,
      time_to_first_byte: 0,
      resource_load_delay: 0,
      resource_load_duration: 0,
      element_render_delay: value,
    };
    const nav = navEntry();
    if (nav) {
      const ttfb = Math.max(0, nav.responseStart - start);
      const url = lcp.url;
      const resource = url
        ? performance.getEntriesByType("resource").find((e) => e.name === url)
        : undefined;
      // Prefer requestStart (when Timing-Allow-Origin is set) over startTime;
      // cap responseEnd at the LCP time (videos keep downloading past LCP).
      const requestStart = Math.max(
        ttfb,
        resource ? (resource.requestStart || resource.startTime) - start : 0,
      );
      const responseEnd = Math.min(
        value,
        Math.max(requestStart, resource ? resource.responseEnd - start : 0),
      );
      attribution.time_to_first_byte = ttfb;
      attribution.resource_load_delay = requestStart - ttfb;
      attribution.resource_load_duration = responseEnd - requestStart;
      attribution.element_render_delay = value - responseEnd;
    }
    report("lcp", value, attribution);
  };

  // Untrusted (programmatic) inputs must not finalize; scrolls are skipped
  // entirely (programmatically generatable). The idle wrapper keeps the
  // finalization off the input's critical path.
  const onInput = (event: Event) => {
    if (!event.isTrusted) return;
    removeEventListener("keydown", onInput, true);
    removeEventListener("click", onInput, true);
    whenIdleOrHidden(finalizeLcp);
  };

  if (!lcpDone) {
    try {
      lcpPo = new PerformanceObserver((list) =>
        handleLcpEntries(list.getEntries()),
      );
      lcpPo.observe({ type: "largest-contentful-paint", buffered: true });
      addEventListener("keydown", onInput, true);
      addEventListener("click", onInput, true);
    } catch {
      lcpDone = true;
    }
  }

  // --- CLS: session windows (1s entry gap, 5s span), worst window wins,
  // reported once when the page first goes hidden ---
  type Shift = { time: number; value: number; target?: string };
  let session = {
    value: 0,
    first: 0,
    last: 0,
    largest: undefined as Shift | undefined,
  };
  let clsValue = 0;
  let clsLargest: Shift | undefined;
  let clsDone = !vitals.includes("cls");
  let clsPo: PerformanceObserver | undefined;

  const handleShifts = (entries: PerformanceEntry[]) => {
    for (const entry of entries as LayoutShift[]) {
      // Shifts right after user input are expected, and excluded by spec.
      if (entry.hadRecentInput) continue;
      const source =
        entry.sources?.find((s) => s.node?.nodeType === 1) ??
        entry.sources?.[0];
      const shift: Shift = {
        time: entry.startTime,
        value: entry.value,
        // Eager, same reason as LCP: the shifted node rarely outlives the
        // wait for the hidden-time report.
        target:
          source?.node instanceof Element ? selectorOf(source.node) : undefined,
      };
      if (
        session.value &&
        entry.startTime - session.last < 1_000 &&
        entry.startTime - session.first < 5_000
      ) {
        session.value += entry.value;
        session.last = entry.startTime;
        if (!session.largest || entry.value > session.largest.value)
          session.largest = shift;
      } else {
        session = {
          value: entry.value,
          first: entry.startTime,
          last: entry.startTime,
          largest: shift,
        };
      }
      if (session.value > clsValue) {
        clsValue = session.value;
        clsLargest = session.largest;
      }
    }
  };

  const reportCls = () => {
    if (clsDone || stopped || !clsPo) return;
    handleShifts(clsPo.takeRecords());
    // The FCP gate (CrUX parity): a page that never painted before it was
    // first hidden reports no CLS, read from the buffered paint entry.
    const fcp = performance
      .getEntriesByType("paint")
      .find((e) => e.name === "first-contentful-paint");
    if (!fcp || fcp.startTime >= firstHidden) return;
    clsDone = true;
    report(
      "cls",
      clsValue,
      clsLargest
        ? {
            largest_shift_target: clsLargest.target,
            largest_shift_time: clsLargest.time,
            largest_shift_value: clsLargest.value,
            load_state: loadStateAt(clsLargest.time),
          }
        : {},
    );
  };

  if (!clsDone) {
    try {
      clsPo = new PerformanceObserver((list) =>
        handleShifts(list.getEntries()),
      );
      clsPo.observe({ type: "layout-shift", buffered: true });
    } catch {
      clsDone = true;
    }
  }

  const onVisibilityChange = (event: Event) => {
    if (document.visibilityState !== "hidden") return;
    firstHidden = Math.min(firstHidden, event.timeStamp);
    finalizeLcp();
    reportCls();
  };
  addEventListener("visibilitychange", onVisibilityChange, true);

  // bfcache restore: a fresh navigation epoch. TTFB re-reports as 0 (the
  // restore served no bytes), LCP as the first double-rAF paint after the
  // restore, and CLS starts accumulating again toward its own hidden-time
  // report; every record minted here carries navigation_type
  // back-forward-cache and a fresh metric id.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || stopped) return;
    restored = true;
    if (vitals.includes("ttfb") && navEntry()) {
      report("ttfb", 0, {
        waiting_duration: 0,
        cache_duration: 0,
        dns_duration: 0,
        connection_duration: 0,
        request_duration: 0,
      });
    }
    if (lcpPo) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!stopped) report("lcp", performance.now() - event.timeStamp, {});
        }),
      );
    }
    if (vitals.includes("cls")) {
      session = { value: 0, first: 0, last: 0, largest: undefined };
      clsValue = 0;
      clsLargest = undefined;
      clsDone = !clsPo;
    }
  };
  addEventListener("pageshow", onPageShow, true);

  return () => {
    stopped = true;
    lcpPo?.disconnect();
    clsPo?.disconnect();
    removeEventListener("load", onLoad, true);
    removeEventListener("keydown", onInput, true);
    removeEventListener("click", onInput, true);
    removeEventListener("visibilitychange", onVisibilityChange, true);
    removeEventListener("pageshow", onPageShow, true);
  };
}
