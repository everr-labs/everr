# 006: Browser profiling capture and pprof conversion

## Verdict: viable with caveats

Browser CPU profiling is capturable today via the JS Self-Profiling API (the `Profiler` interface), and its trace format maps cleanly onto pprof's `profile.proto`. Sentry ships this in production (in beta). The caveats are real and must be accepted up front:

1. **Chromium only.** Chrome/Edge 94+, Opera 80+, Samsung Internet 17+. Firefox and Safari do not implement it and are unlikely to: WebKit's position is negative, and Mozilla raised cross-origin isolation concerns. Roughly 76% global browser coverage. You profile the Chromium demographic only.
2. **The homepage host must send a response header.** `Document-Policy: js-profiling` is required on the document response. A meta tag will not do; if the hosting layer cannot set custom response headers, the feature is off the table. Once set, any script on the page (including third parties) can start a profiler.
3. **Coarse sampling floor.** Chrome clamps `sampleInterval` to 10ms (Mac/Linux/Android) or 16ms (Windows), rounding requested intervals up to a multiple of the platform minimum. This is 100Hz class sampling (DevTools uses 1000Hz), good for field aggregation, not for micro-level analysis.
4. **No off-the-shelf ProfilerTrace to pprof converter exists**, but the mapping is mechanical (details below) and Datadog's `pprof-format` npm package is a zero-dependency, browser-capable pure JS profile.proto encoder, so the conversion is a small amount of glue code, whether done client side or at the ingest edge.
5. **Payload sizes are small.** Field data from ~50,000 profiles (about 7s of capture each) averaged ~25 KB as raw JSON, ~36 KB URL-encoded, and the format compresses well (CompressionStream is available in the same browsers).
6. **Overhead is negligible.** Facebook measured <1% load time slowdown (p=0.05) with profiling enabled.

If Chromium-only coverage and the header requirement are acceptable, this is buildable now. If cross-browser parity is a hard requirement, it is not viable: no comparable API exists in Firefox or Safari.

## The JS Self-Profiling API

Spec: https://wicg.github.io/js-self-profiling/ (WICG draft). MDN overview: https://developer.mozilla.org/en-US/docs/Web/API/Profiler

- Construct with `new Profiler({ sampleInterval, maxBufferSize })`. `sampleInterval` is a desired rate in ms; the UA is not required to honor it exactly (see the Chrome clamping above). `maxBufferSize` caps the sample count; when it fills, sampling stops and a `samplebufferfull` event fires. (spec)
- `stop()` returns a Promise resolving to a `ProfilerTrace` with four parallel arrays (spec):
  - `resources`: script URLs
  - `frames`: `{ name, resourceId, line, column }`
  - `stacks`: `{ frameId, parentId }`, a parent-linked tree of frames
  - `samples`: `{ timestamp, stackId }`, where a missing `stackId` means the JS engine was idle
- Access is gated by Document Policy. The spec now prefers a `js-profiling-mode` configuration (`eager` or `lazy`) and marks the boolean `js-profiling` as deprecated, but `Document-Policy: js-profiling` is what shipped and what Sentry documents. (spec; https://docs.sentry.io/platforms/javascript/profiling/browser-profiling/)
- The profiler pauses when the browsing context loses foreground focus. (spec)

### Browser support

Per caniuse (https://caniuse.com/mdn-api_profiler): Chrome 94+, Edge 94+, Opera 80+, Samsung Internet 17+; Firefox and Safari not supported at any version; ~76.29% global usage. MDN flags the feature as "Limited availability", not Baseline (https://developer.mozilla.org/en-US/docs/Web/API/Profiler). WebKit has taken a negative position; Mozilla's review concluded the API needs cross-origin isolation because of timing side channels (https://github.com/mozilla/standards-positions/issues/477, https://github.com/mozilla/standards-positions/issues/92).

### Field-tested practicalities

From Nic Jansma's production writeup (https://nicj.net/js-self-profiling-api-in-practice/):

- Chrome clamps the interval: 16ms minimum on Windows, 10ms on Mac/Linux/Android, rounded up to a multiple of the minimum.
- Overhead: Facebook reported <1% load time slowdown (p=0.05); the author saw no measurable difference on his own site.
- Payloads: ~25 KB average JSON per ~7s trace over ~50,000 field profiles; ~36 KB URL-encoded; CompressionStream works well.
- Cross-origin scripts without CORS opt-in (`crossorigin="anonymous"` plus `Access-Control-Allow-Origin`) have their frames silently removed from traces.
- `stop()` is Promise-based and will not resolve during page unload, so profiles must be stopped and flushed before `pagehide`.
- Minified names and anonymous inline functions show up as-is; symbolication needs source maps if readable names matter.

## How Sentry does it

Docs: https://docs.sentry.io/platforms/javascript/profiling/browser-profiling/ and https://docs.sentry.io/platforms/javascript/configuration/integrations/browserprofiling/

- Setup is `browserProfilingIntegration()` alongside `browserTracingIntegration()`, plus the server sending `Document-Policy: js-profiling` on the document response. Sentry explicitly notes that hosts that cannot set custom response headers cannot use the feature.
- Feature is in beta; Sentry states it will likely stay there until the spec progresses. Chromium-only, and their docs call out that collected profiles therefore only represent that demographic.
- They sample at 100Hz (10ms period) and contrast that with DevTools at 1000Hz (1ms).
- The SDK converts the `ProfilerTrace` into Sentry's own JSON "Sample Format" and ships it in an envelope. In the current continuous mode (Sample Format V2, envelope item `profile_chunk`), the payload is: `samples` as `{ timestamp, thread_id, stack_id }`, `stacks` as arrays of frame indices ordered leaf to root, and `frames` carrying `function` / `filename` / line info, with stacks deduplicated by the SDK (https://develop.sentry.dev/sdk/telemetry/profiles/sample-format-v2/).

The takeaway: Sentry's target format is structurally the same shape as `ProfilerTrace` (deduplicated stacks referencing a frame table, timestamped samples referencing stacks), which is also exactly the shape pprof wants. The conversion they perform is flattening the parent-linked stack tree into per-stack frame arrays plus renaming fields.

## Mapping ProfilerTrace onto pprof profile.proto

pprof format reference: https://github.com/google/pprof/blob/main/proto/README.md (profile.proto: `sample`, `location`, `function`, `mapping`, `string_table`, `sample_type`, `period`; samples reference location IDs in bottom-up order, leaf first; all strings are indices into `string_table` with index 0 the empty string).

The mapping is clean:

| ProfilerTrace | profile.proto |
| --- | --- |
| `frames[i]` (`name`, `resourceId`, `line`, `column`) | one `Function` (name, filename from `resources[resourceId]`) plus one `Location` with a `Line` referencing it |
| `stacks[i]` (`frameId`, `parentId` chain) | walk the parent links to produce the `location_id` array of a `Sample`, leaf first (the ProfilerTrace stack node is the leaf, so the walk order already matches pprof's bottom-up requirement) |
| `samples[i]` (`timestamp`, `stackId`) | one `Sample`; the value is derived, e.g. `samples` count = 1 and `cpu` nanoseconds = delta to the previous sample timestamp (or the nominal `sampleInterval`) |
| `resources` | strings in `string_table` used as `Function.filename` |
| n/a | one synthetic `Mapping` (no native binaries in JS), `sample_type` = `[samples/count, cpu/nanoseconds]`, `period` = the effective sample interval |

Impedance points, all minor:

- ProfilerTrace samples are timestamped events, not pre-weighted values; the converter assigns weights from timestamp deltas (same thing every JS sampling converter does, e.g. the cpuprofile to pprof approach in https://www.kvakil.me/posts/2022-06-25-converting-nodejs-cpu-profiles-to-pprof.html).
- Samples with no `stackId` represent idle time; drop them or map them to a synthetic `(idle)` location depending on whether wall-time or CPU-time semantics are wanted.
- pprof has no first-class column field on `Line` in the documented core model, so column info from frames is either dropped or encoded in the function name; line numbers carry over directly.
- No existing open source ProfilerTrace to pprof converter turned up in searches (speedscope has importers for Chrome, Firefox, and pprof formats but not for ProfilerTrace: https://github.com/jlfwong/speedscope). Writing one is small: Datadog's `pprof-format` is a pure JS, zero-dependency, browser-capable profile.proto encoder/decoder built for exactly this kind of use (https://github.com/DataDog/pprof-format, https://www.npmjs.com/package/pprof-format). Sentry's open source SDK conversion code is a working reference for the ProfilerTrace side.

## Alternatives considered

- **Chrome DevTools Protocol (`Profiler.start` at 1000Hz): not viable in production.** It requires a debugger attachment (DevTools open, or an automation harness), which does not exist on real visitors' browsers. It is a lab tool, not a field tool.
- **Long Tasks API (`PerformanceObserver` on `longtask`): too coarse.** It reports that a >50ms task happened but carries almost no attribution, so it cannot say what code ran (https://developer.chrome.com/docs/web-platform/long-animation-frames).
- **Long Animation Frames API (LoAF): the best pseudo-profiling fallback, still Chromium-only.** Shipped in Chrome 123, it attributes long frames to specific scripts (source URL, invoker, duration) and breaks down style/layout time, which is far better than longtask but still script-level attribution, not stack sampling, and it does not help with Firefox/Safari coverage either (https://developer.chrome.com/docs/web-platform/long-animation-frames, https://developer.mozilla.org/en-US/docs/Web/API/PerformanceScriptTiming).
- For Firefox and Safari there is no production-grade profiling primitive at all; any design should treat those browsers as out of scope for profiling and rely on coarser RUM signals there.

## Sources

- WICG spec: https://wicg.github.io/js-self-profiling/
- MDN Profiler: https://developer.mozilla.org/en-US/docs/Web/API/Profiler
- MDN JS Self-Profiling API overview: https://developer.mozilla.org/en-US/docs/Web/API/JS_Self-Profiling_API
- caniuse: https://caniuse.com/mdn-api_profiler
- Mozilla standards positions: https://github.com/mozilla/standards-positions/issues/477 and https://github.com/mozilla/standards-positions/issues/92
- Nic Jansma, "JS Self-Profiling API In Practice": https://nicj.net/js-self-profiling-api-in-practice/
- Sentry browser profiling docs: https://docs.sentry.io/platforms/javascript/profiling/browser-profiling/
- Sentry BrowserProfiling integration: https://docs.sentry.io/platforms/javascript/configuration/integrations/browserprofiling/
- Sentry Sample Format V2: https://develop.sentry.dev/sdk/telemetry/profiles/sample-format-v2/
- pprof profile.proto docs: https://github.com/google/pprof/blob/main/proto/README.md
- pprof-format (pure JS encoder): https://github.com/DataDog/pprof-format
- cpuprofile to pprof conversion writeup: https://www.kvakil.me/posts/2022-06-25-converting-nodejs-cpu-profiles-to-pprof.html
- Long Animation Frames API: https://developer.chrome.com/docs/web-platform/long-animation-frames
- speedscope importers: https://github.com/jlfwong/speedscope
