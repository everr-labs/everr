/// <reference path="../../dom.d.ts" />

import type { AttrValue, Emit } from "../../pipeline/emitter.js";
import { selectorOf } from "../element.js";
import type { WebVitalName } from "./index.js";
import { emitVital, whenIdleOrHidden } from "./shared.js";

// The usual web vitals: LCP, CLS, and TTFB. This package calculates them. It
// sends one `browser.web_vital` record for each metric in each navigation
// period. The record contains the attribution that the attribution build of the
// web-vitals library gives, with the prefix
// `everr.browser.web_vital.<metric>.`. The attributes that the semconv defines,
// which are name, value, delta, and id, keep their names without a prefix.
//
// The SDK sends the TTFB record at the load event, in a usual batch. It sends
// the LCP record and the CLS record when the page becomes hidden the first
// time. It can also send the LCP record at the first keyboard input or click
// input. The flush at exit collects each record that the SDK sends while the
// page is hidden. The INP is in inp.ts, and it uses the same Event Timing
// observer as the slow-interaction records.
//
// This code comes from the GoogleChrome/web-vitals library
// (https://github.com/GoogleChrome/web-vitals, copyright Google LLC, Apache
// License 2.0). That code gives the LCP result at the first input or when the
// page becomes hidden, it makes the CLS session windows with a gap of 1 s and a
// maximum of 5 s, it reads the parts of the TTFB from the navigation entry, it
// divides the LCP into phases from the resource timing, and it uses the first
// hidden time as a limit.
//
// This module is different from web-vitals in four conditions. Each difference
// decreases the number of bytes in the build:
//
// - The SDK sends a maximum of one record for each metric in each navigation
//   period. The previous code removed the duplicates by the metric id, and it
//   also discarded the additional CLS reports of web-vitals. Thus the records
//   on the network do not change. Therefore delta is always equal to value.
// - The FCP test for the CLS reads the paint entry from the buffer when the SDK
//   sends the record. It does not operate a paint observer. The web-vitals
//   library uses the FCP as a limit for the CLS, to agree with CrUX.
// - This module ignores the prerender conditions, the same as inp.ts. The
//   activationStart value still changes the values. But the code that follows
//   the visibility ignores the `prerendering` state, and navigation_type is
//   never "prerender" and never "restore".
// - The targets of the attribution use the shared selectorOf function, with the
//   same names as `everr.element.selector`. They do not use the selectors with
//   the class names from web-vitals.

type Attrs = Record<string, AttrValue | null | undefined>;
type Classic = Exclude<WebVitalName, "inp">;

/** Gives the navigation entry when the code can use its responseStart value.
 * This is the test from web-vitals. The value is zero for privacy. It is
 * negative or in the future when the browser has a defect. */
function navEntry(): PerformanceNavigationTiming | undefined {
  const e = performance.getEntriesByType("navigation")[0];
  return e && e.responseStart > 0 && e.responseStart < performance.now()
    ? e
    : undefined;
}

const activationStart = () => navEntry()?.activationStart || 0;

/** The phase of the document at a timestamp. The CLS load_state attribute uses
 * it. */
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

  let stopped = false;
  let restored = false;

  // Each caller examines `stopped` before it sends a record.
  const report = (
    name: Classic,
    value: number,
    attribution: Attrs,
    timestamp?: number,
  ) => {
    const extra: Attrs = {};
    for (const [key, v] of Object.entries(attribution)) {
      extra[`everr.browser.web_vital.${name}.${key}`] = v;
    }
    emitVital(emit, name, value, restored, extra, timestamp);
  };

  // The first time in the life of the page when the page was hidden. The code
  // ignores each entry that the browser painted after that time. Thus a tab
  // that loads in the background sends no LCP record. The code uses the
  // visibility-state entry from the buffer, which Chrome gives. If that entry
  // is absent, it uses the test at the load time.
  let firstHidden = document.visibilityState === "hidden" ? 0 : Infinity;
  const hiddenEntry = performance
    .getEntriesByType("visibility-state")
    .find((e) => e.name === "hidden");
  if (hiddenEntry) firstHidden = hiddenEntry.startTime;

  // --- TTFB: the parts of the navigation entry. The SDK sends the record after
  // the load event, because then the entry has all its values. ---
  const reportTtfb = () => {
    if (stopped) return;
    const nav = navEntry();
    if (!nav) return;
    const start = nav.activationStart || 0;
    const value = Math.max(nav.responseStart - start, 0);
    // The code measures from workerStart or from fetchStart. Thus the start
    // time of a service worker goes into cache_duration. The interval from
    // connectEnd to requestStart goes into request_duration. Thus
    // connection_duration stays 0 when a service worker operates.
    const waitEnd = Math.max((nav.workerStart || nav.fetchStart) - start, 0);
    const dnsStart = Math.max(nav.domainLookupStart - start, 0);
    const connectStart = Math.max(nav.connectStart - start, 0);
    const connectEnd = Math.max(nav.connectEnd - start, 0);
    report(
      "ttfb",
      value,
      {
        waiting_duration: waitEnd,
        cache_duration: dnsStart - waitEnd,
        dns_duration: connectStart - dnsStart,
        connection_duration: connectEnd - connectStart,
        request_duration: value - connectEnd,
      },
      nav.responseStart,
    );
  };
  const onLoad = () => setTimeout(reportTtfb);
  if (vitals.includes("ttfb")) {
    if (document.readyState === "complete") setTimeout(reportTtfb);
    else addEventListener("load", onLoad, { once: true, capture: true });
  }

  // --- LCP: the most recent largest-contentful-paint entry that the code
  // accepts. The code completes it at the first keyboard input or click input,
  // or when the page becomes hidden. ---
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
        // The code captures this immediately. The element can go out of the DOM,
        // or it can change, a long time before the code completes the record at
        // an input or at the hidden state. If the element is not in the DOM but
        // it had an id, that id still gives its name.
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
      // The code uses requestStart when the Timing-Allow-Origin header permits
      // it. If not, it uses startTime. The maximum value of responseEnd is the
      // LCP time, because a video continues to download after the LCP.
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
    report("lcp", value, attribution, lcp.startTime);
  };

  // An input from the code is not trusted, and it must not complete the record.
  // The code fully ignores a scroll, because the code can also cause a scroll.
  // The idle function keeps this work out of the necessary path of the input.
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

  // --- CLS: the session windows. A window ends after a gap of 1 s between the
  // entries, and its maximum length is 5 s. The window with the largest value
  // wins. The SDK sends one record when the page becomes hidden the first
  // time. ---
  type Shift = { time: number; value: number; target?: string };
  let session = {
    value: 0,
    first: 0,
    last: 0,
    largest: undefined as Shift | undefined,
  };
  let clsValue = 0;
  let clsLargest: Shift | undefined;
  let clsTime: number | undefined;
  let clsDone = !vitals.includes("cls");
  let clsPo: PerformanceObserver | undefined;

  const handleShifts = (entries: PerformanceEntry[]) => {
    for (const entry of entries as LayoutShift[]) {
      // A shift immediately after an input from the user is usual, and the
      // specification does not count it.
      if (entry.hadRecentInput) continue;
      const source =
        entry.sources?.find((s) => s.node?.nodeType === 1) ??
        entry.sources?.[0];
      const shift: Shift = {
        time: entry.startTime,
        value: entry.value,
        // The code captures this immediately, for the same reason as the LCP.
        // The node that moved usually goes out of the DOM before the page
        // becomes hidden and the SDK sends the record.
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
        clsTime = session.last;
      }
    }
  };

  const reportCls = () => {
    if (clsDone || stopped || !clsPo) return;
    handleShifts(clsPo.takeRecords());
    // The FCP test, which makes this value the same as the CrUX value. The code
    // reads the paint entry from the buffer. If the browser painted nothing
    // before the page became hidden the first time, the SDK sends no CLS
    // record.
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
      clsTime ?? firstHidden,
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

  // The browser gives the page from the bfcache. This starts a new navigation
  // period. The SDK sends the TTFB again with the value 0, because this
  // operation sent no bytes. It sends the LCP for the first paint after two
  // animation frames. The CLS starts to add its values again, and the SDK sends
  // it when the page becomes hidden. Each record from this function has the
  // navigation_type value back-forward-cache and a new metric id.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || stopped) return;
    restored = true;
    if (vitals.includes("ttfb") && navEntry()) {
      report(
        "ttfb",
        0,
        {
          waiting_duration: 0,
          cache_duration: 0,
          dns_duration: 0,
          connection_duration: 0,
          request_duration: 0,
        },
        event.timeStamp,
      );
    }
    if (lcpPo) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!stopped) {
            const now = performance.now();
            report("lcp", now - event.timeStamp, {}, now);
          }
        }),
      );
    }
    if (vitals.includes("cls")) {
      session = { value: 0, first: 0, last: 0, largest: undefined };
      clsValue = 0;
      clsLargest = undefined;
      clsTime = undefined;
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
