# Session recorder prior art (rrweb, Sentry, PostHog, HyperDX, Datadog)

**Date:** 2026-10-17
**Question:** How do rrweb-style session recorders behave in practice, and what do the main products do for bundle size, event volume, on-error buffering, masking, segment shipping and storage?

Short answer for Everr (10 KB gzipped budget in `packages/otel-web`, ClickHouse, no object storage):

- No rrweb-based recorder fits the core bundle. The smallest rrweb build is about 20 KB gzipped (Sentry's fork), 23 KB for upstream `@rrweb/record`. A recorder must be a lazy-loaded chunk. Datadog's own (non-rrweb) recorder chunk is 11.5 KB gzipped, which shows what a purpose-built serializer can reach.
- Volume is dominated by full snapshots and by mutation-heavy pages: 13 KB/min gzipped on a small SPA, 124 KB/min on a static article (almost all the one snapshot), 650 KB/min on a docs SPA with client-side navigation.
- Sentry's on-error mode is "checkout every 60 s and drop everything before the latest checkout", so an error replay covers 0 to 60 s before the error, not a full 60 s.
- HyperDX is the only one of the three that stores replays in ClickHouse: each rrweb event is a JSON string in an OTLP log record body, split at 950 KB, in a dedicated `hyperdx_sessions` table. Sentry and PostHog both put recording bytes in blob storage and only metadata in ClickHouse.

All numbers marked "measured" were produced for this note (method in [Appendix](#appendix-how-the-numbers-were-measured)). Everything else cites source code or official docs.

---

## 1. Bundle size

Measured: each entry imports only `record` (or the integration), bundled with esbuild `--bundle --minify --format=esm`, then `gzip -9`. Versions are the npm `latest` on 2026-10-17.

| Package (version) | What it is | min | gzip |
|---|---|---:|---:|
| `rrweb` 2.1.7, `import { record }` | Upstream all-in-one package. Does not tree-shake the replayer away. | 181.7 KB | **57.8 KB** |
| `rrweb` 2.1.7, `import *` | Recorder + replayer | 261.1 KB | 81.5 KB |
| `@rrweb/record` 2.1.7 | Upstream record-only package | 74.7 KB | **23.0 KB** |
| `@rrweb/record` + `@rrweb/packer/pack` | Adds fflate-based per-event packing | 81.8 KB | 26.5 KB |
| `@sentry-internal/rrweb` 2.43.0 | Sentry's fork, `record` only | 64.5 KB | **19.9 KB** |
| `@posthog/rrweb-record` 0.0.60 | PostHog's fork, record only | 80.7 KB | 25.1 KB |
| `@amplitude/rrweb-record` 2.1.4 | Amplitude fork (did not tree-shake under esbuild) | 185.6 KB | 58.6 KB |
| `@sentry-internal/replay` 10.57.0, `replayIntegration` | Full Sentry Replay integration incl. `@sentry/core` and inlined compression worker | 167.2 KB | 54.9 KB |
| `posthog-js` 1.438.12 `dist/recorder.js` | PostHog lazy chunk: rrweb + plugins | 135.0 KB | 41.3 KB |
| `posthog-js` 1.438.12 `dist/lazy-recorder.js` | PostHog lazy chunk incl. the session-recording logic | 215.4 KB | 67.1 KB |
| `@hyperdx/otel-web-session-recorder` 4.0.0 | HyperDX recorder: full `rrweb` + protobuf OTLP logs encoder + fflate | 275.2 KB | 84.3 KB |
| `@datadog/browser-rum` 7.16.0 `bundle/chunks/datadogRecorder-*.js` | Datadog lazy recorder chunk, own serializer (not rrweb) | 32.8 KB | **11.5 KB** |
| `fflate` `gzipSync` alone | For reference: client-side gzip | 6.9 KB | 3.5 KB |

Notes:

- Sentry documents "an additional ~36KB gzipped" for Replay as of SDK 7.78.0 ([performance overhead docs](https://docs.sentry.io/product/explore/session-replay/web/performance-overhead/)). Our 54.9 KB number for 10.57.0 includes `@sentry/core`, which a real app already ships with `@sentry/browser`.
- Sentry recommends lazy-loading Replay with `Sentry.addIntegration()` after startup ([session replay docs](https://docs.sentry.io/platforms/javascript/session-replay/)).
- PostHog always lazy-loads the recorder: `lazy-loaded-session-recorder.ts` lives under `extensions/replay/external/` and is shipped as the separate `lazy-recorder.js` / `posthog-recorder.js` dist files (posthog-js `packages/browser/src/extensions/replay/external/`, commit `3ddaa654`).
- HyperDX imports the recorder statically in `@hyperdx/browser` (`packages/browser/src/index.ts`: `import SessionRecorder from '@hyperdx/otel-web-session-recorder'`), so it is not lazy.
- Datadog keeps its deflate worker (pako-derived, inlined as a Blob URL string) in the main `datadog-rum.js` bundle, not in the 11.5 KB recorder chunk (`esm/domain/deflate/deflateWorker.mjs`).

## 2. Event volume per minute

Measured with `@rrweb/record` 2.1.7, `maskAllInputs: true`, default sampling, headless Chromium 1280x800, 60 s of scripted interaction per page. "gzip" is gzip of the whole minute's JSON array (one stream, so it is a best case vs. per-segment compression).

| Page | Scenario | Events | Raw JSON | gzip | Full snapshot (raw / gzip) | Everything else (raw / gzip) |
|---|---|---:|---:|---:|---:|---:|
| TodoMVC React | add 12 todos by typing, toggle 6, switch 3 filters, then mouse moves | 898 | 154 KB | **13 KB** | 19 KB / 4.5 KB | 136 KB / 8.4 KB |
| Wikipedia article | 30 scroll + mouse steps | 154 | 992 KB | **124 KB** | 966 KB / 119 KB | 26 KB / 4.4 KB |
| react.dev `/learn` | 5 client-side navigations, scroll and mouse after each | 470 | 4.55 MB | **650 KB** | 702 KB / 110 KB | 3.85 MB / 542 KB |
| react.dev, `checkoutEveryNms: 15000` | same | 490 | 6.95 MB | **1.06 MB** | 3.09 MB / 514 KB | 3.86 MB / 542 KB |

Event mix (TodoMVC): 360 Mutation (75 KB raw), 368 Input (39 KB), 86 MouseMove (12.5 KB), 81 MouseInteraction (7.7 KB). On react.dev, 194 Mutation events were 3.7 MB raw: SPA route changes arrive as large add-node mutations, so "incremental" is not small on SPAs.

What this means:

- One full snapshot of a content page is 100 to 120 KB gzipped. Every periodic checkout repeats that cost, which is why Sentry's 60 s buffer checkout and PostHog's 5 min default exist.
- Compression ratio is 7x to 12x on rrweb JSON.
- Sentry stops a replay when a mutation emits 10,000+ nodes and adds a warning breadcrumb at 750 ([performance overhead docs](https://docs.sentry.io/product/explore/session-replay/web/performance-overhead/)); PostHog and HyperDX run a per-node mutation rate limiter (HyperDX `MutationRateLimiter`: bucket 100, refill 10, `packages/session-recorder/src/sessionrecording-utils.ts`).

Third-party write-ups give similar ranges (20 to 170 KB/min compressed), but none publish a method, so they are not used here.

## 3. On-error buffer mode

### rrweb primitive

`record()` has `checkoutEveryNms` and `checkoutEveryNth`. On each event rrweb checks `e.timestamp - lastFullSnapshotEvent.timestamp > checkoutEveryNms` and takes a new full snapshot, emitting it with `isCheckout = true` (`rrweb/dist/rrweb.js` 2.1.7, `record()`). So the checkout fires on the first event after the interval, not on a timer. The rrweb guide's recipe for "last N minutes before an error" keeps an array per checkout and sends the **last two** arrays, giving N to 2N of history ([rrweb guide.md, Checkout](https://github.com/rrweb-io/rrweb/blob/master/guide.md#checkout)).

### Sentry Replay (`@sentry-internal/replay` 10.57.0)

Source: `packages/replay-internal/src/` at tag `10.57.0`.

- `replaysOnErrorSampleRate` puts the session in `recordingMode = 'buffer'` (`replay.ts`, `startBuffering()`).
- In buffer mode `record()` gets `checkoutEveryNms: BUFFER_CHECKOUT_TIME`, which is `60_000` (`constants.ts`; `replay.ts` `startRecording()`). The code comment: "we'll always keep the last 60 seconds of replay before an error happened".
- On each checkout in buffer mode the buffer is **cleared** (`util/addEvent.ts`: `if (isCheckout && isBufferMode) eventBuffer.clear()`) and the session start is reset (`util/handleRecordingEmit.ts`: `replay.setInitialState()`). Only one checkout period is kept, so the pre-error window is 0 to 60 s, not a guaranteed 60 s. The docs describe it as "the last 60 seconds of event logs in a memory ring buffer" ([understanding sessions](https://docs.sentry.io/platforms/javascript/session-replay/understanding-sessions/)).
- When an error is sampled, the session is marked dirty and tagged with `replayId` (`coreHandlers/handleGlobalEvent.ts`). `sendBufferedReplayOrFlush()` flushes the buffer immediately, stops the recorder, switches to `recordingMode = 'session'` and restarts recording, which takes a fresh full snapshot (`replay.ts`). Recording then continues like a normal session.
- If the buffer exceeds `REPLAY_MAX_EVENT_BUFFER_SIZE` (20 MB uncompressed) in buffer mode, it is cleared and waits for the next checkout (`util/addEvent.ts`).
- Other limits (`constants.ts`): idle pause 5 min, idle expire 15 min, max replay 60 min, min replay duration 5 s.
- Opt-in experiment: `_experiments.continuousCheckout` sets periodic checkouts in session mode with a 6 min floor, for seeking (`replay.ts`).

### PostHog

Source: posthog-js `packages/browser/src/extensions/replay/external/lazy-loaded-session-recorder.ts`, commit `3ddaa654`.

- There is no "on error" sample rate. PostHog has triggers (URL, event, linked feature flag); while triggers are pending the status is `BUFFERING` and nothing is flushed (`_flushBuffer`: `if (status === BUFFERING || ...) return`).
- While triggers are pending, full snapshots are taken every `trigger_pending_buffer_interval_millis`, default **1 min**, clamped to 1 s .. 1 h. Otherwise the periodic full snapshot interval is `full_snapshot_interval_millis`, default **5 min** (`_fullSnapshotIntervalMillis`).
- On a full snapshot with pending triggers, the buffer is cut to start at the most recent meta event (`_clearBufferBeforeMostRecentMeta()`), the same "keep only since last checkout" model as Sentry.
- On `beforeunload` while still `BUFFERING`, the buffer is discarded (`_onBeforeUnload`).

### HyperDX

No buffer mode. `RumRecorder` records continuously from `init()`, capped at 4 h per session (`MAX_RECORDING_LENGTH`), and only `stop()` / `resume()` exist (hyperdx-js `packages/session-recorder/src/index.ts`, commit `77350427`).

### Datadog (for comparison)

A full snapshot is taken at start and on every RUM view creation (`esm/domain/record/startFullSnapshots.mjs`), not on a timer.

## 4. Masking and blocking defaults

| | Text | Inputs | Media | Block / mask hooks |
|---|---|---|---|---|
| **rrweb** 2.1.7 `record()` | not masked | only `password` masked (`maskInputOptions` default `{ password: true }`); `maskAllInputs: true` masks every input type incl. `select` and `textarea` | recorded; `inlineImages: false`, `recordCanvas: false`, `collectFonts: false` | `blockClass: 'rr-block'`, `ignoreClass: 'rr-ignore'`, `maskTextClass: 'rr-mask'`, `blockSelector`/`maskTextSelector`/`ignoreSelector: null`, `maskInputFn`, `maskTextFn`, `slimDOMOptions` (source: `record()` defaults in `rrweb/dist/rrweb.js`; [guide.md options table](https://github.com/rrweb-io/rrweb/blob/master/guide.md)) |
| **Sentry** | `maskAllText: true` | `maskAllInputs: true` | `blockAllMedia: true` blocks `img,image,svg,video,object,picture,embed,map,audio,link[rel="icon"],link[rel="apple-touch-icon"]` and ignores CSS `background-image` | default mask selector `.sentry-mask,[data-sentry-mask]`; block `.sentry-block,[data-sentry-block],base,iframe[srcdoc]:not([src])`; ignore `.sentry-ignore,[data-sentry-ignore],input[type="file"]`; `title` and `placeholder` attributes masked with text; network bodies opt-in via `networkDetailAllowUrls: []` (`integration.ts`, `util/getPrivacyOptions.ts`, `constants.ts`) |
| **PostHog** | not masked (`maskTextSelector: undefined`); set `'*'` to mask all | `maskAllInputs: true`, `maskInputOptions: { password: true }` | recorded; `recordCanvas` off unless enabled; `inlineStylesheet: true` with a 10,000-rule budget | `blockClass: 'ph-no-capture'`, `ignoreClass: 'ph-ignore-input'`, `maskTextClass: 'ph-mask'`; a project-level server setting can override (`maskAllInputs ?? true`); network header/body deny lists in `config.ts` (`lazy-loaded-session-recorder.ts`) |
| **HyperDX** | `@hyperdx/browser` default `maskAllText: false` (the recorder package itself defaults `maskTextSelector: '*'`, which the browser SDK overrides) | `maskAllInputs: true` | recorded; `recordCanvas: false` | `blockClass` pass-through, other rrweb options pass-through (`packages/browser/src/index.ts`, `packages/session-recorder/src/index.ts`) |

## 5. Chunking and shipping

| | Endpoint and format | Compression | Segment / batch size | Page unload |
|---|---|---|---|---|
| **Sentry** | Envelope to the DSN's `/api/<project>/envelope/` with two items: `replay_event` (JSON metadata: `replay_id`, `segment_id`, `error_ids`, `trace_ids`, `urls`, `replay_type`) and `replay_recording` (a `{"segment_id":N}\n` header line + payload) (`util/createReplayEnvelope.ts`, `util/prepareRecordingData.ts`, `util/sendReplayRequest.ts`) | zlib deflate via fflate `Zlib`, streaming, in a Web Worker (`packages/replay-worker/src/Compressor.ts`); falls back to an uncompressed array buffer until the worker loads (`eventBuffer/EventBufferProxy.ts`) | Debounced flush: min 5 s, max 5.5 s after the first event (`DEFAULT_FLUSH_MIN_DELAY`/`MAX_DELAY`). Each flush is one segment with incrementing `segment_id`. Relay limits: 10 MiB compressed, 100 MiB uncompressed per replay item (relay `relay-config/src/config.rs`) | Flushes on `visibilitychange` to hidden and on window `blur` (`replay.ts` `_doChangeToBackgroundTasks` → `conditionalFlush()`). The fetch transport sets `keepalive` only while pending bodies are ≤ 60,000 bytes and < 15 requests (`packages/browser/src/transports/fetch.ts`) |
| **PostHog** | `$snapshot` events with `$snapshot_data`, `$session_id`, `$window_id`, `$snapshot_bytes` POSTed to `/s/` with batch key `recordings` (`_captureSnapshot`, `BASE_ENDPOINT = '/s/'`) | Full snapshots and mutation payloads are gzipped per event with fflate `gzipSync` (or async `CompressionStream`) and carried as strings, marker `cv: '2024-10'`; the batch request can additionally use the core request layer's `gzip-js` / `base64` compression modes, chosen per request (`lazy-loaded-session-recorder.ts`, `request.ts`; not traced further) | Recorder buffer flushes after 2 s (`RECORDING_BUFFER_TIMEOUT`) or when it would exceed ~0.9 MB (`RECORDING_MAX_EVENT_SIZE`); the request queue then flushes every 3 s by default (`request-queue.ts` `DEFAULT_FLUSH_INTERVAL_MS`) | On `beforeunload` and again on `pagehide`: drain the compression queue synchronously, then flush; the request queue sends with `sendBeacon` on unload (`_onBeforeUnload`, `_onPageHide`; `posthog-core.ts` `_handle_unload`, `request-queue.ts` `unload()`). If still `BUFFERING`, the buffer is dropped |
| **HyperDX** | OTLP/HTTP protobuf logs to `/v1/logs` (default `https://in-otel.hyperdx.io/v1/logs`). One log record per rrweb event, `body` = the event as a JSON **string**, scope `rum.rr-web`, attributes `rr-web.offset`, `rr-web.event`, `rr-web.chunk`, `rr-web.total-chunks`; resource carries `rum.sessionId` (`index.ts`, `OTLPLogExporter.ts`) | Whole request gzipped with fflate `gzipSync`, `Content-Encoding: gzip`, `Content-Type: application/x-protobuf` (`OTLPLogExporter.ts`) | Events over `MAX_CHUNK_SIZE` (950 KB) are split into several log records; each event is first capped at 5 MB by replacing data URIs (`ensureStringifiedMaxMessageSize`). Batch processor flushes 5 s after the first queued log (`BatchLogProcessor.ts`) | Flushes on `window` `unload` with a plain `fetch` (no `keepalive`, no `sendBeacon`), so the last batch is likely lost on navigation (`BatchLogProcessor.ts`, `OTLPLogExporter.ts`) |
| **Datadog** (comparison) | multipart `FormData`: `segment` (binary) + `event` (JSON metadata with `raw_segment_size`, `compressed_segment_size`, `records_count`, `index_in_view`) (`segmentCollection/buildReplayPayload.mjs`) | streaming deflate in an inline Web Worker | Segment closes at 5 s or 60,000 compressed bytes, or on view change; the comment says this leaves room under the 64 KB beacon limit (`segmentCollection/segmentCollection.mjs`) | On page exit (except hidden) the segment is sent with `sendBeacon` (`httpRequest.sendOnExit`) |

## 6. Storage

### HyperDX: ClickHouse, as OTel logs

- The collector routes any log with attribute `rr-web.event` to a separate pipeline and ClickHouse exporter writing `logs_table_name: hyperdx_sessions` with `ttl: 720h` (hyperdx `docker/otel-collector/config.standalone.yaml`, commit `748315d7`).
- `hyperdx_sessions` has the standard OTel-collector logs schema: `Body String CODEC(ZSTD(1))`, `ResourceAttributes`/`LogAttributes Map(LowCardinality(String), String)`, bloom-filter indexes on map keys/values, `PARTITION BY toDate(TimestampTime)`, `ORDER BY (ServiceName, TimestampTime, Timestamp)`, `TTL ... ttl_only_drop_parts = 1` (`docker/otel-collector/schema/seed/00004_hyperdx_sessions.sql`). The sort key is not session-first; a replay is fetched with `ServiceName = ? AND ResourceAttributes['rum.sessionId'] = ?`, ordered by timestamp, `rr-web.offset`, `rr-web.chunk`, paged with a limit (`packages/app/src/sessions.ts`).
- The UI reassembles chunked events per `rr-web.event` id and sorts by chunk index, after a bug where out-of-order chunks broke `JSON.parse` ([hyperdx#2569](https://github.com/hyperdxio/hyperdx/issues/2569); `packages/app/src/utils/rrwebChunkAssembler.ts`).
- The session list comes from the traces table, not from `hyperdx_sessions`: it looks for spans named `record init` or `visibility` per `rum.sessionId` (`packages/app/src/sessions.ts`).

### Sentry: blob storage + ClickHouse metadata

- Relay accepts the envelope; recording segments are written as blobs keyed `{retention_days or 30}/{project_id}/{replay_id}/{segment_id}` (sentry `src/sentry/replays/lib/storage.py`, commit `624fb343`). `StorageBlob` "does not have managed TTLs"; keys are prefixed by TTL (30, 60, 90 days) so bucket lifecycle rules can expire them. The backend is configured with `replay.storage.backend` (GCS in SaaS; a legacy `FilestoreBlob` path exists for self-hosted).
- Replay metadata (one row per segment: `segment_id`, `error_ids`, `trace_ids`, `urls`, ...) goes to ClickHouse via Snuba, table `replays_local` (snuba `snuba/datasets/configuration/replays/storages/replays.yaml`, commit `b7e150b2`).

### PostHog: blob storage + ClickHouse metadata

From the [session replay architecture handbook page](https://posthog.com/handbook/engineering/session-replay/session-replay-architecture):

- A Rust capture service in `recordings` mode receives `/s/` and writes to Kafka `session_recording_snapshot_item_events` (overflow topic for billing-limited or hot sessions).
- A Node blob-ingestion consumer groups by session, writes newline-delimited `[windowId, event]` lines, compresses each session block with Snappy, and flushes at 10 s buffer age or 100 MB. Batch files go to S3 as multipart uploads; each holds many session blocks, addressed by byte range (`s3://bucket/key?range=bytes=start-end`).
- ClickHouse `session_replay_events` (AggregatingMergeTree) holds per-session aggregates: first/last timestamp, block URLs and timestamps, click/keypress/console counts, active ms, size, `retention_period_days`. The older `session_recording_events` table stored raw snapshot data in ClickHouse and is deprecated.
- Postgres `posthog_sessionrecording` is only used for pinned / long-term-storage recordings.

## 7. Licenses

| Component | License | Source |
|---|---|---|
| rrweb, `@rrweb/record`, `@rrweb/packer`, `rrweb-snapshot` | MIT | [rrweb LICENSE](https://github.com/rrweb-io/rrweb/blob/master/LICENSE), npm metadata |
| `@sentry-internal/rrweb` (fork), `@sentry-internal/replay`, sentry-javascript | MIT | sentry-javascript `LICENSE`, npm metadata |
| Sentry server, Relay | FSL-1.1-Apache-2.0 (Functional Source License, converts to Apache 2.0 after two years) | sentry and relay `LICENSE.md` |
| posthog-js | Apache-2.0 (npm also lists MIT) | posthog-js `LICENSE`, npm `(Apache-2.0 AND MIT)` |
| `@posthog/rrweb*` forks | MIT | npm metadata |
| PostHog server | MIT, except `ee/` (separate license) | posthog `LICENSE` |
| `@hyperdx/browser`, `@hyperdx/otel-web-session-recorder` | Apache-2.0; recorder is a derivative of Splunk's `@splunk/otel-web-session-recorder` (Apache-2.0, copyright header in `index.ts`) | hyperdx-js package `LICENSE` |
| HyperDX server/app | MIT | hyperdx `LICENSE` |
| `@datadog/browser-rum` | Apache-2.0 | npm metadata |
| fflate | MIT | npm metadata |

## Takeaways for Everr

1. **Lazy chunk is mandatory.** The cheapest upstream rrweb recorder (23 KB gzipped) is over twice the whole SDK budget. Sentry's fork saves 3 KB. A purpose-built recorder like Datadog's is 11.5 KB but is not reusable (it is not rrweb-format, and the player is proprietary).
2. **HyperDX proves "rrweb as OTLP logs into ClickHouse" works**, but its specifics are weak: static import, `unload` + plain `fetch`, unordered sort key for session lookup, session list derived from spans, chunk-ordering bug. The good parts to keep: the `rr-web.*` chunk attributes, a separate table via collector routing, and ZSTD on `Body`. Custom attributes would go under `everr.` per the repo rules.
3. **Full snapshots drive cost.** Expect around 100 KB gzipped per snapshot on content pages. Buffer-on-error with a 60 s checkout costs one snapshot per minute of client CPU even when nothing is sent; Sentry clears the buffer on each checkout, so the pre-error window is 0 to 60 s. Keeping two checkout windows (rrweb guide recipe) guarantees at least 60 s at the cost of memory.
4. **Shipping:** every product flushes every 2 to 5 s, compresses on the client (worker in Sentry and Datadog), and handles unload explicitly. The beacon/keepalive 64 KB cap shapes Datadog's 60 KB segment limit and Sentry's keepalive cutoff.
5. **Masking defaults differ:** Sentry masks all text, all inputs and blocks media by default; PostHog and HyperDX mask inputs only. A new SDK should pick a default deliberately and document it.

## Appendix: how the numbers were measured

- **Bundle sizes:** `npm i` of the listed versions, an entry file per row (e.g. `import { record } from '@rrweb/record'; window.r = record;`), `esbuild --bundle --minify --format=esm`, `gzip -9 | wc -c`. Pre-built dist files (PostHog, Datadog) were gzipped as shipped.
- **Event volume:** Playwright 1.58.2 headless Chromium, `@rrweb/record` 2.1.7 UMD injected after `load`, `record({ emit, maskAllInputs: true })`, scripted interactions for 60 s, events serialized with `JSON.stringify` and gzipped with Node `zlib.gzipSync` at the default level. Pages: `https://todomvc.com/examples/react/dist/`, `https://en.wikipedia.org/wiki/OpenTelemetry`, `https://react.dev/learn`. These are single runs on public sites on 2026-10-17; treat them as orders of magnitude, not benchmarks.
- **Source commits read:** sentry-javascript tag `10.57.0`; posthog-js `3ddaa65402896c91dcb7b04cfe433e0b1d2f3313`; hyperdx-js `77350427759e0e083d18982efe24fed07fe9b7fd`; hyperdx `748315d7af3d0da46ef0baf45b52c424ca1d9387`; sentry `624fb343cb8e0f9c1b852e6860c426fb7804b739`; relay `83696ac63b9296bc9fd5ccfb26708e3dc84c06b4`; snuba `b7e150b20a5e7151cbeb0983edbec8d6987348c5`; rrweb npm 2.1.7 dist and `master` docs (`9b9a1ff3`); `@datadog/browser-rum` 7.16.0 npm dist.
