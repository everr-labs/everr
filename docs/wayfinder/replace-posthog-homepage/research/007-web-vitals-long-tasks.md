# 007: Web vitals and long tasks in the browser, and their shape as OTel log records

**Answer first:** Use the `web-vitals` library v5 with the attribution build (`import {onLCP, onCLS, onINP, onFCP, onTTFB} from 'web-vitals/attribution'`), queue metric callbacks in memory, and flush the queue with `navigator.sendBeacon()` (or `fetch(..., {keepalive: true})` as fallback) whenever `document.visibilityState` becomes `hidden`. For main-thread jank, prefer the Long Animation Frames API (`long-animation-frame` PerformanceObserver entries, Chrome 123+) over the older `longtask` entries: it has far better attribution (script source URL, function name, invoker) and web-vitals v5 already surfaces LoAF data inside INP attribution. Emit each finalized metric as one OTel log record with event name `browser.web_vital` and the attribute names `browser.web_vital.name`, `.value`, `.delta`, `.id`, `.rating`, `.navigation_type`: these are the exact names in the OTel semantic conventions (Development stability) and in the new `open-telemetry/opentelemetry-browser` instrumentation, so aligning with them is cheap and future-proof. There is no stable OTel package to adopt wholesale yet (the browser SDK repo is experimental, the old js-contrib plugin request never shipped), so hand-roll the ~40 lines using those names. For the TanStack Router SPA: browsers attribute all Core Web Vitals to the initial (hard) navigation URL, so record both the landing page URL and the route active at metric time as extra attributes; do not reset metrics on route change. The soft navigations API that fixes this properly is still an origin trial (Chrome 139) and web-vitals `reportSoftNavs` needs Chromium 151+, so treat it as a later opt-in, not a dependency.

## 1. The web-vitals library (v5)

Source: https://github.com/GoogleChrome/web-vitals and https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/docs/upgrading-to-v5.md

### Metrics and browser support

v5 exposes `onLCP`, `onCLS`, `onINP`, `onFCP`, `onTTFB`. FID and `onFID()` were removed in v5 (deprecated in v4, supplanted by INP). v5 also moved to "Baseline Widely available" browser support and renamed `LCPAttribution.element` to `LCPAttribution.target`.

Per the README's browser support table: `onFCP`, `onINP`, `onLCP`, `onTTFB` work in Chromium, Firefox, and Safari; `onCLS` is Chromium only; soft navigation metrics require Chromium 151+.

Every metric callback receives a `Metric` object with fields `name`, `value`, `rating` (`good` | `needs-improvement` | `poor`), `delta`, `id`, `entries`, `navigationType`, plus (new for soft nav support) `navigationId` and `navigationURL`.

### When each metric finalizes

- **TTFB**: waits until after page load so all `navigation` entry properties are populated, then fires once.
- **FCP**: fires once the value is ready (first contentful paint observed).
- **LCP**: candidate entries can keep arriving; the value is finalized when the user interacts or the page is hidden. With `reportAllChanges: true` the callback fires on every new `largest-contentful-paint` entry; otherwise once when final.
- **CLS**: "callback is always called when the page's visibility state changes to hidden" and "might be called multiple times during the same page load" (each call carries a `delta`). Also reported again after back/forward cache restore.
- **INP**: same hidden-state reporting as CLS; never reported if the user never interacts. Also re-reported after bfcache restores.
- Metrics may never fire at all: CLS, FCP, LCP are not reported for pages loaded in the background; INP is not reported without an interaction.

Practical consequence: TTFB and FCP arrive early; LCP, CLS, INP mostly arrive at page-hide time, so delivery must survive tab close.

### Flush pattern and delivery

The README recommends batching callbacks into a queue and flushing on `visibilitychange` to `hidden` (explicitly preferred over `beforeunload`/`unload`, which are unreliable and break bfcache):

```js
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushQueue();
});
```

Delivery should use `navigator.sendBeacon('/ingest', body)` because it "supports sending data as the page is being unloaded", with `fetch(url, {body, method: 'POST', keepalive: true})` as the fallback. Because CLS and INP can report multiple times with `delta` values, dedupe server-side by metric `id` (keep the latest `value`) or sum deltas. Note: Safari does not fire `visibilitychange` in every tab-close path, so also listening to `pagehide` as a belt-and-braces flush is common practice; the library itself keys all its final reporting off the hidden state.

### Attribution build

Import from `web-vitals/attribution` to get a `metric.attribution` object per metric (same API, slightly larger bundle):

- **LCP**: `target` (CSS selector of the LCP element), `url` (LCP image resource), `timeToFirstByte`, `resourceLoadDelay`, `resourceLoadDuration`, `elementRenderDelay`, plus raw `navigationEntry`, `lcpResourceEntry`, `lcpEntry`.
- **INP**: `interactionTarget` (selector), `interactionType` (`pointer` | `keyboard`), `interactionTime`, `nextPaintTime`, `inputDelay`, `processingDuration`, `presentationDelay`, `loadState`, and LoAF-derived diagnostics: `longAnimationFrameEntries`, `longestScript`, `totalScriptDuration`, `totalStyleAndLayoutDuration`, `totalPaintDuration`, `totalUnattributedDuration`.
- **CLS**: `largestShiftTarget` (selector), `largestShiftTime`, `largestShiftValue`, `largestShiftEntry`, `largestShiftSource`, `loadState`.
- **FCP**: `timeToFirstByte`, `firstByteToFCP`, `loadState`, `fcpEntry`, `navigationEntry`.
- **TTFB**: `waitingDuration`, `cacheDuration`, `dnsDuration`, `connectionDuration`, `requestDuration`, `navigationEntry`.

The raw `*Entry` objects are not serializable as-is; pick the scalar fields for log attributes.

## 2. Long tasks vs Long Animation Frames

### longtask (PerformanceLongTaskTiming)

Source: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming

`new PerformanceObserver(cb).observe({type: 'longtask', buffered: true})` reports tasks that occupy the main thread for 50 ms or more. Entries carry `entryType: "longtask"`, `startTime`, `duration` (1 ms granularity), a `name` that only identifies the browsing context (`self`, `same-origin`, `cross-origin-ancestor`, etc.), and an `attribution` array of `TaskAttributionTiming` (`containerType`, `containerSrc`, `containerId`, `containerName`). The attribution is famously near-useless: it tells you which frame ran the task, never which script or function. MDN marks the feature Experimental and "Limited availability" (not Baseline); in practice it is Chromium-only (no Safari, no Firefox).

### long-animation-frame (LoAF)

Sources: https://developer.chrome.com/docs/web-platform/long-animation-frames and https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming

Shipped in Chrome 123; entry type `"long-animation-frame"`, same 50 ms threshold but measured per rendering frame instead of per task. Also not Baseline (Chromium-only today). Each `PerformanceLongAnimationFrameTiming` entry has `startTime`, `duration`, `blockingDuration` (the part exceeding 50 ms that actually blocked high-priority work: the best single "badness" number), `renderStart`, `styleAndLayoutStart`, `firstUIEventTimestamp`, and a `scripts` array of `PerformanceScriptTiming` with real attribution: `invoker` (e.g. `IMG#id.onload`), `invokerType` (`user-callback`, `event-listener`, `resolve-promise`, `reject-promise`, `classic-script`, `module-script`), `sourceURL`, `sourceFunctionName`, `sourceCharPosition`, `executionStart`, `duration`, `forcedStyleAndLayoutDuration` (layout thrashing), `pauseDuration`, and `windowAttribution`.

### Which to prefer

Prefer LoAF. Chrome's guidance is that longtask gave only "basic attribution" while LoAF provides script-level detail down to function name and character position; longtask is not being deprecated but LoAF is the recommended replacement lens for responsiveness work. Since both APIs are Chromium-only anyway, choosing LoAF costs no reach. Two concrete recommendations for this project:

1. Do not ship a standalone `longtask` observer.
2. Get most LoAF value for free through INP attribution (`longestScript`, `totalScriptDuration`, etc. from web-vitals v5). Optionally add a dedicated LoAF observer that emits its own event only for frames above a high threshold (e.g. `blockingDuration > 100ms` or top-N per page) to bound volume; report `blockingDuration`, the worst script's `sourceURL`/`sourceFunctionName`/`invokerType`/`duration`, and flush through the same hidden-state queue.

## 3. SPA considerations (TanStack Router homepage)

Sources: https://web.dev/articles/vitals-spa-faq, https://developer.chrome.com/docs/web-platform/soft-navigations-experiment, https://developer.chrome.com/blog/new-soft-navigations-origin-trial

Browsers measure each Core Web Vital "relative to the current, top-level page navigation", so every metric is attributed to the URL of the initial hard navigation. Client-side route changes in a SPA do not reset anything: CLS keeps accumulating across routes (it "doesn't reset after a route transition like it does with full page loads in an MPA"), and INP spans the whole page lifetime. FCP/LCP/TTFB only ever describe the landing load.

Google's current guidance for SPAs is to keep browser semantics and add metadata: record "both the current route URL as well as the original page URL" so you can slice by landing route and by the route active when the metric finalized. For this homepage that means two attributes on every metric event: the initial `page.url` (or landing route path) and the TanStack Router route path at report time (route ID/pattern preferably, e.g. `/blog/$slug`, to keep cardinality low). INP attribution's `interactionTarget` plus the current route is usually enough to localize a slow interaction to a screen.

The proper fix, the soft navigations API, detects URL-updating DOM changes as navigations, assigns each a `navigationId`, and re-emits per-navigation LCP (`interaction-contentful-paint`), CLS, and INP. It is in an origin trial as of Chrome 139 and targeted for launch later, and web-vitals v5 exposes it behind `onCLS(cb, {reportSoftNavs: true})` requiring Chromium 151+. Enabling it also changes hard-load semantics (initial-URL metrics finalize at the first soft nav). Recommendation: design the event shape now with `navigation_id` and `navigation_url` fields (web-vitals already populates `navigationId`/`navigationURL` on the Metric object) but leave `reportSoftNavs` off until the API is stable.

## 4. OpenTelemetry alignment

Sources: https://opentelemetry.io/docs/specs/semconv/browser/browser-events/, https://github.com/open-telemetry/opentelemetry-browser, https://raw.githubusercontent.com/open-telemetry/opentelemetry-browser/main/packages/instrumentation/src/web-vitals/semconv.ts, https://github.com/open-telemetry/opentelemetry-js-contrib/issues/1461, https://github.com/honeycombio/honeycomb-opentelemetry-web/blob/main/docs/web-vitals.md

There IS an official semantic convention, at Development (experimental) stability: the event name MUST be `browser.web_vital`, with fields `name` (enum: `cls`, `fid`, `inp`, `lcp`), `value` (double), `delta` (double), `id` (string).

There is also a real instrumentation, but not in js-contrib: the Client Instrumentation SIG's new repo `open-telemetry/opentelemetry-browser` ships an experimental `@opentelemetry/browser-instrumentation` package whose web-vitals module uses `web-vitals/attribution` (`onCLS`, `onINP`, `onLCP`, `onFCP`, `onTTFB`) and emits log records with severity INFO, event name `browser.web_vital`, and attributes with these exact strings:

- `browser.web_vital.name`
- `browser.web_vital.value`
- `browser.web_vital.delta`
- `browser.web_vital.id`
- `browser.web_vital.rating`
- `browser.web_vital.navigation_type`

with attribution optionally serialized into the log body (`includeRawAttribution` config, `JSON.stringify(metric.attribution)`) and an `applyCustomLogRecordData` hook. The older js-contrib request (issue #1461, "Core Web Vitals Plugin") never produced a package; the work moved to this repo. Vendor precedent (Honeycomb) uses per-metric namespaced attributes like `lcp.resource_load_delay`, `cls.largest_shift_target`, `inp.element`, which confirms the pattern of flattening attribution into snake_case scalars.

Verdict: do not depend on the experimental package, but adopt its names exactly. The semconv only standardizes name/value/delta/id (+ rating and navigation_type in the implementation); extend under the same `browser.web_vital.*` namespace for attribution fields, which keeps a later migration to the official instrumentation a no-op for the core fields.

## 5. Recommended log record shape

One OTel log record per finalized metric report. Event name `browser.web_vital` (set as the log record's event name / `event.name`), severity INFO, timestamp = time the metric was reported. Dedupe by `browser.web_vital.id` (CLS/INP may report more than once; latest `value` wins, or sum `delta`).

Common attributes (every metric):

| Attribute | Type | Source |
|---|---|---|
| `browser.web_vital.name` | string enum: `lcp`, `cls`, `inp`, `fcp`, `ttfb` | `metric.name.toLowerCase()` |
| `browser.web_vital.value` | double (ms; unitless for CLS) | `metric.value` |
| `browser.web_vital.delta` | double | `metric.delta` |
| `browser.web_vital.id` | string | `metric.id` |
| `browser.web_vital.rating` | string: `good`, `needs-improvement`, `poor` | `metric.rating` |
| `browser.web_vital.navigation_type` | string: `navigate`, `reload`, `back-forward`, `back-forward-cache`, `prerender`, `restore`, `soft-navigation` | `metric.navigationType` |
| `browser.web_vital.navigation_id` | string (optional now, required once soft navs land) | `metric.navigationId` |
| `page.url` | string | initial hard-navigation URL |
| `page.route` | string, low-cardinality route pattern | TanStack Router matched route ID at report time |

Per-metric attribution attributes (flattened scalars, same namespace):

- **LCP**: `browser.web_vital.lcp.target` (selector), `.lcp.url`, `.lcp.time_to_first_byte`, `.lcp.resource_load_delay`, `.lcp.resource_load_duration`, `.lcp.element_render_delay`
- **INP**: `browser.web_vital.inp.interaction_target`, `.inp.interaction_type`, `.inp.input_delay`, `.inp.processing_duration`, `.inp.presentation_delay`, `.inp.load_state`, `.inp.longest_script_source_url`, `.inp.longest_script_function_name`, `.inp.longest_script_invoker_type`, `.inp.total_script_duration`
- **CLS**: `browser.web_vital.cls.largest_shift_target`, `.cls.largest_shift_value`, `.cls.largest_shift_time`, `.cls.load_state`
- **FCP**: `browser.web_vital.fcp.time_to_first_byte`, `.fcp.first_byte_to_fcp`, `.fcp.load_state`
- **TTFB**: `browser.web_vital.ttfb.waiting_duration`, `.ttfb.cache_duration`, `.ttfb.dns_duration`, `.ttfb.connection_duration`, `.ttfb.request_duration`

Optional companion event for jank (Chromium only, sampled or thresholded): event name `browser.long_animation_frame` with `browser.long_animation_frame.duration`, `.blocking_duration`, `.start_time`, `.first_ui_event_timestamp`, and worst-script fields `.script.source_url`, `.script.function_name`, `.script.invoker`, `.script.invoker_type`, `.script.duration`, `.script.forced_style_and_layout_duration`, plus the same `page.url` / `page.route`. There is no semconv for this event yet, so the name is ours; the field names mirror the platform API so they stay self-documenting.

Delivery: buffer all records, flush on `visibilitychange` to hidden (plus `pagehide` for Safari), send via `navigator.sendBeacon` with `fetch keepalive` fallback, cap beacon payloads under 64 KB.

## Sources

- web-vitals README: https://github.com/GoogleChrome/web-vitals
- web-vitals v5 upgrade guide: https://github.com/GoogleChrome/web-vitals/blob/main/docs/upgrading-to-v5.md
- SPA and Core Web Vitals FAQ: https://web.dev/articles/vitals-spa-faq
- Soft navigations experiment: https://developer.chrome.com/docs/web-platform/soft-navigations-experiment
- Soft navigations origin trial (Chrome 139): https://developer.chrome.com/blog/new-soft-navigations-origin-trial
- Long Animation Frames API: https://developer.chrome.com/docs/web-platform/long-animation-frames
- MDN PerformanceLongAnimationFrameTiming: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming
- MDN PerformanceLongTaskTiming: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming
- OTel semconv, browser events: https://opentelemetry.io/docs/specs/semconv/browser/browser-events/
- OTel browser SDK repo: https://github.com/open-telemetry/opentelemetry-browser
- OTel browser web-vitals semconv constants: https://github.com/open-telemetry/opentelemetry-browser/blob/main/packages/instrumentation/src/web-vitals/semconv.ts
- js-contrib Core Web Vitals plugin issue: https://github.com/open-telemetry/opentelemetry-js-contrib/issues/1461
- Honeycomb web vitals attribute precedent: https://github.com/honeycombio/honeycomb-opentelemetry-web/blob/main/docs/web-vitals.md
