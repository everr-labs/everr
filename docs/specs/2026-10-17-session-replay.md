# Session Replay

**Date:** 2026-10-17
**Status:** proposed
**Labels:** ready-for-agent

## Problem Statement

When something goes wrong in a web app, a developer looks at a failing Trace or an error in Everr and has to guess what the person on the page did and saw. The Traces, Logs, and errors show what the system did. They do not show the screen: which button was clicked, what the page looked like, whether a spinner stayed forever, whether the error was even visible. The developer asks the reporter for screenshots, tries to reproduce the issue by hand, and often cannot.

Agents have the same gap. An Agent investigating a problem can read Logs and Traces, but it cannot tell what the person did between them.

## Solution

The WebSDK gets a replay Instrumentation, `recording()`, that keeps the last 5 minutes of the page's DOM history in memory with rrweb. Nothing leaves the page until a Clip is emitted: automatically on an error or a failed request, or by the integrator with `emitRecording()`. A Clip is sent as OTLP Logs, routed by the collector into its own ClickHouse table, and stored in both the Cloud and the local Collector: with the Plan retention in the Cloud, and with the local Collector's `--ttl` (7 days by default) locally. The Recording of a Session is all its Clips.

```ts
import { emitRecording, markRecording } from "@everr/otel-web/recording";

emitRecording({ last: 15_000 });             // the last 15 seconds
markRecording("cart-open");
emitRecording({ since: "cart-open", next: 10_000 }); // from the mark, plus 10 seconds after
```

A developer debugging a problem opens a Trace or an error. If a Clip covers that moment, the player sits at the top of the view, opened at the matching moment. Under it is the existing trace view. Clicking a Span seeks the player to that moment; while the player plays, the Span under the clock is selected. The error's stack stays `exception.stacktrace` on the exception log, which the error view already renders. Logs and errors that have a `TraceId` and a `SpanId` are drawn on that waterfall by a join from `logs`. They are not OTel span events: `addEvent` and `recordException` record nothing on this tracer.

The privacy bundle is on when the WebSDK `dev` option is not true: all text and inputs are Masked and media is Blocked. Integrators tune this with options and markers. `dev` is that option, not the build and not the Local or Production origin. `dev` changes privacy only; Clips work the same with or without it.

Agents use the `query` tool they already have. They read the Session's Logs and Traces as a text timeline, see marks as logs, and find Clips through one `recording` span per Clip. Agents never read the raw rrweb payload.

## User Stories

### Developer debugging a Session

1. As a developer debugging a problem, I want to open a Trace and see the Clip that covers it, so that I can see what the person did and saw.
2. As a developer, I want the player to open at the moment of the Span I came from, so that I do not have to scrub through the Clip.
3. As a developer, I want to open an error and see the Clip at the moment of the Span that carries that error, so that I can see the screen when it failed.
4. As a developer, I want the error's stack to remain visible as `exception.stacktrace` on the exception log, so that the player adds to the error view instead of replacing it.
5. As a developer, I want the existing waterfall, span details, filters, and flamegraph under the player, so that I keep the tools I already use.
6. As a developer, I want to click a Span and have the player seek to it, so that I can jump between what the system did and what the screen showed.
7. As a developer, I want the selected Span to follow the player clock while it plays, so that I can see which request belongs to which screen change.
8. As a developer, I want Logs and errors that share a `TraceId` and `SpanId` with a Span drawn on the waterfall, so that I have one timeline instead of two. A log with no span id stays off the waterfall.
9. As a developer, I want a backend Trace (a server function, a same-origin API call, a cross-origin call that sends `traceparent`) to open the Clip of the browser Session that caused it, so that backend problems also get a player.
10. As a developer, I want the player area to say there is no Clip at this moment, with links to the Session's other Clips, so that I know the absence is expected and can still jump to what was recorded.
11. As a developer, I want no player at all on a Trace with no Session (cron, webhooks, a full page load document request), so that the view stays clean when there is nothing to play.
12. As a developer, I want the player to show one Clip of the document I came from, so that a second tab in the same Session does not confuse the player. An SPA navigation stays in that Stream.
13. As a developer, I want to see the trigger moment and the tail after it in an automatic Clip, so that I know what led to the error and what the person saw after it.
14. As a developer, I want to see a gap where a Segment was lost or the recorder was paused, so that I do not mistake missing data for the page doing nothing.
15. As a developer, I want the player to load quickly, so that I do not wait. A Clip is at most about 6 minutes long and 10 MB raw, so the player loads it whole.
16. As a developer working locally, I want the player to work against the local Collector exactly as it does in the Cloud, so that I can debug Sessions on my machine.
17. As a developer, I want to find Sessions that have a Clip with a `traces` query on the `recording` span, so that I can list or search Recordings without a dedicated view.

### Integrator setting up the WebSDK

18. As an integrator, I want to add recording with one Instrumentation, `recording()`, so that setup matches the other Instrumentations.
19. As an integrator, I want `recording()` to come from its own subpath, `@everr/otel-web/recording`, so that apps that do not record pay no bundle cost.
20. As an integrator, I want the recorder code to load only when the Session is sampled, so that unsampled Sessions download nothing extra.
21. As an integrator, I want not to install rrweb myself, so that the WebSDK owns the recorder version.
22. As an integrator, I want one `sampleRate`, default 1, to set the share of Sessions that buffer, so that one control bounds both recorder CPU and data sent.
23. As an integrator, I want the sampling decision to be the same across tabs and reloads of a Session, so that a Recording is not split by sampling.
24. As an integrator, I want an error captured by the WebSDK (unhandled error, rejection, React boundary, manual capture) to emit a Clip of the last 60 seconds and the 10 seconds after, so that I see what led to it and what followed.
25. As an integrator, I want a request with a 5xx response or no response to emit the same Clip when `network()` is installed, so that failed requests get a Clip too.
26. As an integrator, I want a 4xx not to be a trigger, so that validation errors do not fill my quota.
27. As an integrator, I want errors removed by the `errors()` `ignore` and `denyUrls` filters not to emit a Clip, so that filtered noise stays filtered.
28. As an integrator, I want a burst of errors to extend one automatic Clip, and at most 5 automatic Clips per Session, so that an error storm does not multiply the data.
29. As an integrator, I want `emitRecording({ last })` to send a Clip of the last N milliseconds, so that I can keep what led to a moment I care about.
30. As an integrator, I want `markRecording(name)` and `emitRecording({ since: name })`, so that I can send a whole flow, from where it started to now.
31. As an integrator, I want `next` on `emitRecording()` to keep the Clip open for up to 60 seconds after the call, so that I also see what happens next.
32. As an integrator, I want a Clip whose start has left the buffer to start at the oldest buffered moment and say it was truncated, so that I know the Clip is shorter than asked.
33. As an integrator, I want `pauseRecording()` and `resumeRecording()`, so that a sensitive screen my markup cannot cover is never buffered.
34. As an integrator, I want `emitRecording()` and `markRecording()` to do nothing in an unsampled Session, documented, so that I am not surprised by missing Clips.
35. As an integrator, I want a documented warning that wrapping `recording()` in `sampled()` multiplies the rate, so that I am not surprised by fewer Clips.
36. As an integrator, I want a new Session during a page to start a new buffer with a new sampling decision, so that a Clip never mixes two Sessions.
37. As an integrator, I want Clips to count against the same telemetry quota as everything else, so that there is no second limit to manage.
38. As an integrator on Hobby or Pro, I want Clips to work on both Plans with the Plan retention, so that recording is not a separate purchase.

### Integrator controlling privacy

39. As an integrator, I want all text Masked by default when the privacy bundle is on, so that personal data on screen is not stored.
40. As an integrator, I want all input values Masked by default when the privacy bundle is on, so that form contents are not stored.
41. As an integrator, I want `title`, `placeholder`, and `aria-label` Masked by default when the privacy bundle is on, so that attributes do not leak what text Masking hides.
42. As an integrator, I want password inputs always Masked, even with `maskAllInputs` off or under `unmask`, so that a password never reaches storage.
43. As an integrator, I want media (`img`, `svg`, `video`, `object`, `picture`, `embed`, `map`, `audio`, icon links) Blocked by default when the privacy bundle is on, so that images of people and documents are not stored. A CSS `background-image` is not Blocked; the docs say so.
44. As an integrator, I want a Blocked element to keep its size, so that the layout in the player still makes sense.
45. As an integrator, I want file inputs Ignored, so that file selection is not recorded.
46. As an integrator, I want the privacy bundle off when the WebSDK `dev` option is true, so that I see my own page as it is while developing.
47. As an integrator, I want explicit options to win over the defaults whether or not the WebSDK `dev` option is true, except that passwords stay Masked and file inputs stay Ignored, so that I can tune either.
48. As an integrator, I want the `everr-mask`, `everr-block`, and `everr-ignore` classes and the matching `data-everr-*` attributes, so that I can mark elements in markup.
49. As an integrator, I want `mask`, `unmask`, `block`, `unblock`, and `ignore` selector options that add to the markers, so that I can mark elements I do not control.
50. As an integrator, I want `unmask` to win over Mask and `unblock` to win over Block, so that I can reveal safe areas like navigation.
51. As an integrator, I want `maskFn` to replace the default asterisk substitution, so that I can choose how Masked text looks.
52. As an integrator, I want `maskAttributes` to choose which attributes are Masked, so that I can cover custom attributes that carry personal data.
53. As an integrator, I want option names that match Sentry's, so that migrating from Sentry is mechanical.
54. As an integrator, I want Masking to happen in the browser before events enter the buffer, so that unmasked data never leaves the page.
55. As an integrator, I want Cookieless and Consented modes to use the same privacy rules, so that consent mode does not change what is recorded.

### End user of an integrator's app

56. As a person using an app with recording, I want the page to stay responsive and the buffer to stay under a fixed memory cap, so that recording does not degrade my experience.
57. As a person leaving a page, I want the exit flush to stay small, so that recording does not crowd out the app's own telemetry.

### Agent

58. As an Agent, I want to read a Session's timeline from Logs and Traces with the existing `query` tool, so that I need no new tool to understand a problem.
59. As an Agent, I want to find a Clip by filtering `traces` for `SpanName = 'recording'` and `session.id`, so that I can tell a developer a Clip exists.
60. As an Agent, I want `everr.recording.trigger` on the `recording` span, so that I know why the Clip was sent.
61. As an Agent, I want marks as logs on the Session's timeline, even in Sessions with no Clip, so that I can see where flows started.
62. As an Agent, I want the telemetry skill to tell me the recordings table holds rrweb and is the wrong payload, so that I do not waste tokens on it.
63. As an Agent, I want a window around the entry time when the entry has a time, and the latest rows otherwise, so that my read stays small.

### Everr operator

64. As an Everr operator, I want Clips in their own table, so that a bad Clip batch cannot fail an ordinary log insert.
65. As an Everr operator, I want Clips partitioned by day and retention, so that a Plan change drops whole parts.
66. As an Everr operator, I want Clip inserts in small row batches with a short flush, so that ClickHouse does not get tiny parts or huge 8192-row batches of 950 KB bodies.
67. As an Everr operator, I want `app.recordings` off the SQL API grant list with a default-deny row policy, so that tenants and Agents cannot query raw rrweb through the SQL API.
68. As an Everr operator, I want a Segment not to be counted twice across the routing split, so that billing is correct.

## Implementation Decisions

### Capture: the replay Instrumentation (WebSDK)

- `recording()` is a factory exported from the new subpath `@everr/otel-web/recording`. Its code stays out of the main entry. The shared transport gains gzip (see Transport), so the main entry budget is measured again with `pnpm size` and raised only by that change. size-limit gets two new lines: the `recording()` stub and the recorder chunk.
- The stub decides sampling and calls `import()` for the recorder chunk only when the Session is sampled. This is the first dynamic import in the WebSDK, so the build must emit the recorder as its own chunk.
- **Cost of the default.** `sampleRate` defaults to 1, so every Session loads the recorder chunk (about 23 KB gzip) and runs rrweb's observers for the life of the page, even when no Clip is ever sent. This is the price of having the minutes before an error; Sentry makes the same trade. An integrator who wants no recorder cost on most Sessions lowers `sampleRate`.
- The recorder is upstream `@rrweb/record`, bundled into the chunk at an exact pinned version. The player uses `@rrweb/replay` at the same version. Both come from the rrweb monorepo release `rrweb@2.1.7`, which the decisions here are checked against. The recorder is about 23 KB gzip. Integrators do not install it.
- One recorder per page. Only the first `recording()` installed on a page records; a `recording()` on a second `WebSDK` instance does nothing.
- Options, all at the top level. Buffer length, memory cap, snapshot interval, automatic Clip length, merge rules, and the automatic Clip cap are not options.

  ```ts
  recording({
    sampleRate, // default 1
    maskAllText, maskAllInputs, blockAllMedia,
    mask, unmask, block, unblock, ignore, maskFn, maskAttributes,
  })
  ```

- `sampleRate` is decided once per Session with `hashUnit()`, the hash `sampled()` uses, over `${sessionId}:recording`. Every tab and reload of a Session decides the same way. An outer `sampled()` multiplies with this rate; this is documented, not prevented. `sampled()` decides once at setup, so `recording()` keeps its own per-Session decision and does not reuse the `sampled()` wrapper.

### The buffer

- **Streams.** One Stream per document per Session: the buffer of that document. Each Stream has a random `everr.recording.stream.id`. Two tabs of one Session give two Streams at once.
- **Stream id on the envelope.** While a Stream buffers, the instrumentation sets ambient `everr.recording.stream.id` through the same set as `setAttributes`, and clears it when the Stream ends. The envelope copies that set onto every later log and span. SPA navigation rotates `everr.page_view.id` and leaves the stream id in place. A hard navigation starts a new document, so it starts a new Stream.
- **Length and memory.** The buffer holds the last 5 minutes, capped at 10 MB of raw rrweb JSON. When the cap is reached, the oldest events go first. Masking runs before events enter the buffer.
- **Snapshots.** A full snapshot (rrweb checkout) every 10 seconds. Every snapshot is kept for the last 60 seconds; older ones are thinned to one per minute. So a Clip that starts within the last minute starts at most 10 seconds early, and an older one at most 60 seconds early (see Clip start).
- **Pause.** `pauseRecording()` stops the rrweb recorder; nothing is buffered while paused, so no Clip can contain that time. `resumeRecording()` starts it again with a full snapshot. Both act on the current page. A Clip that covers a paused range shows it as a gap.
- **Session change.** When the Session id changes during a page, the current Stream ends and its buffer is dropped, the rate is decided again, and a new Stream starts with a full snapshot. A Clip never mixes two Sessions.
- **The buffer does not keep the Session alive.** Every record reads `sessionId()`, which refreshes Session activity. Segments, the `recording` span, and mark logs read the Session id through a passive read that does not refresh activity, so a large Clip does not extend the Session. Only the app's own records keep it alive.
- **Large events.** A single rrweb event larger than 950 KB goes alone in its own Segment. If that request is larger than the collector's 20 MiB body limit, the collector rejects it and the gap shows in the index.

### Clips

- **API.** Named exports from `@everr/otel-web/recording`, the same kind of export as `identify` and `captureError`. `recording()` returns only the teardown `WebSDK` calls on shutdown.

  ```ts
  emitRecording(options?: ({ last: number } | { since: string | number }) & { next?: number });
  markRecording(name: string);
  pauseRecording();
  resumeRecording();
  ```

  - `last`: milliseconds before the call. `since`: a mark name, or an epoch-millisecond timestamp. They cannot be used together. With neither, the Clip is the whole buffer.
  - `next`: milliseconds after the call that the Clip stays open. Default 0 for `emitRecording()`, maximum 60 000.
  - All four do nothing before the recorder chunk has loaded or in an unsampled Session, except that `markRecording()` still emits its mark log (see Marks). The docs say so.
- **Clip start.** rrweb can only play from a full snapshot. A Clip starts at the last full snapshot at or before the requested start and carries the requested start; the player starts playing there. When the requested start is before the oldest buffered moment (the 5 minute window, the memory cap, the Stream start, or a `since` mark that has left the buffer), the Clip starts at the oldest buffered moment and sets `everr.recording.clip.truncated = true`.
- **Independent Clips.** Each Clip is sent whole and on its own. Two Clips that overlap both carry the overlapping events; duplicate data is accepted. A Clip has a random `everr.recording.clip.id`.
- **Sending.** At the call (or at the trigger), the part already in the buffer is sent at once as Segments. If `next` is set, the tail is sent as more Segments when it closes. A page hide during the tail loses only the unsent tail. `everr.recording.segment.index` counts from 0 per Clip.
- **Automatic Clips.** A trigger emits a Clip with `last: 60_000` and `next: 10_000`. Triggers reach the Instrumentation through internal seams; `InstrumentationContext` gets no new public member:
  - any error on the shared capture path, after the `errors()` `ignore` and `denyUrls` filters;
  - a `network()` span with a 5xx response or no response (fetch rejects, XHR `error` or `timeout`). A 4xx is not a trigger. `recording()` does not patch fetch itself.
- **Merge and cap.** A trigger that comes while an automatic Clip's tail is open extends that tail to 10 seconds after the new trigger, up to 60 seconds after the Clip's first trigger. A trigger after that starts a new automatic Clip. A Session has at most 5 automatic Clips; the count is kept next to the Session in the identity store, so every tab and reload shares it. Manual Clips never merge and do not count toward the cap.
- **Trigger.** `everr.recording.trigger` is `error` or `network` for an automatic Clip (from its first trigger) and `manual` for `emitRecording()`.
- **`recording` span.** One internal span per Clip, named `recording`, emitted when the Clip is complete (after its tail). It is created with `startSpan`, `root: true`, and `startTime` set to the requested start, and ended at the end of the Clip, so it covers the Clip's range. `startSpan` does not join the active stack, so clicks, requests, and logs do not become its children. It carries the envelope, `everr.recording.clip.id`, `everr.recording.stream.id`, `everr.recording.trigger`, and `everr.recording.clip.truncated`. When the page hides during a tail, the span goes in the exit flush with its end at the page hide; Spans get the first share of the exit budget. It is one extra span and trace per Clip; it counts as a span against usage, and the trace list leaves out root spans named `recording`. Agents and the player find Clips with it.
- **No span ids inside a Clip.** A Clip joins the other signals by `session.id`, `everr.recording.stream.id`, and time. No custom rrweb events carry span ids.

### Marks

- `markRecording(name)` puts a named point in the current Stream's buffer for `emitRecording({ since: name })`. A later mark with the same name replaces the earlier one. A mark leaves the buffer with the events at its time.
- Each mark also emits a log with event name `everr.browser.recording.mark` and `everr.recording.mark.name`, stored in `logs` like any other log. The log is emitted in unsampled Sessions too, so a mark is on every Session's timeline. It is not routed to the recordings table, because routing matches only the `.segment` event name.

### Privacy layer

- Runs in the browser, before events enter the buffer. No scrub in the collector. Cookieless and Consented modes use the same rules.
- One default bundle chosen by the WebSDK `dev` option: on when `dev` is not true, off when `dev` is true. Explicit options win in both cases, except that passwords stay Masked and file inputs stay Ignored. The markers and selector options always apply. `dev` is the only gate: an app deployed with `dev: true` (for example a staging build) sends unmasked text, inputs, attributes, and media. The docs say that `dev` must be false anywhere real people use the app.
- When the bundle is on: Mask all text and inputs; Mask `title`, `placeholder`, and `aria-label`; Block media (`img`, `svg`, `video`, `object`, `picture`, `embed`, `map`, `audio`, icon links), `base`, and same-origin `srcdoc` iframes; Ignore file inputs. A CSS `background-image` is not Blocked; the docs list this as a known gap.
- Passwords stay Masked with `maskAllInputs: false` and under `unmask`. `unblock` does not reveal a password. File inputs stay Ignored whatever the options.
- Markers always in the selector lists: `everr-mask`, `everr-block`, `everr-ignore`, and the matching `data-everr-*` attributes. `unmask` wins over Mask; `unblock` wins over Block.
- Mapping onto rrweb options, decided against `rrweb@2.1.7`:
  - all text: `maskTextSelector: "*"`, with `maskTextFn` returning the text unchanged under `unmask` and otherwise applying `maskFn` or the asterisk substitution;
  - inputs: `maskInputFn`, which keeps passwords Masked in every case;
  - Block: `blockSelector`, with `unblock` expressed as `:not(...)` because rrweb matches each element on its own. rrweb does not record the children of a Blocked element, so `unblock` cannot reveal an element inside a Blocked parent; unblock the parent instead;
  - Ignore: `ignoreSelector`;
  - `maskAttributes`: rrweb has no hook, so the `emit` callback rewrites those attributes in full-snapshot nodes and attribute mutations before the event enters the buffer. No rrweb fork.
- Not taken from Sentry: network body capture, server-side scrub, the canvas plugin. Cross-origin iframes, canvas, and shadow DOM behave as rrweb records them; the docs describe that behaviour, with no custom handling.

### Transport

- A Segment is one OTLP Log on the existing logs emitter. Event name `everr.browser.recording.segment`. Body: the rrweb events as JSON.
- A Segment holds up to about 950 KB of JSON. A tail closes its current Segment every 5 seconds. Each Segment is sent on its own request through the logs send path, but not through the shared logs queue.
- The WebSDK gzips a request with `CompressionStream` (`Content-Encoding: gzip`) when the browser supports it and the page is not in the exit flush. If gzip is missing or fails, the request is plain JSON. This applies to all WebSDK requests, not only Segments. `Content-Encoding` is not a CORS-safelisted request header, and browser ingest is cross-origin. The same change adds `Content-Encoding` to every browser OTLP CORS allow-list: `allowed_headers` in `collector/config.example.yml`, and the `cors` block in `collector/internal/localgateway/config/config.go` (that block sets `allowed_origins` only, so rs/cors allows simple headers only). `collector/config.yml` is gitignored, so each deployed collector config gets the same header at rollout, before the WebSDK release that sends gzip. Without the header, the preflight fails and ordinary log and span export stops.
- Exit flush (page hide, page becoming hidden): the keepalive budget stays 64 KB. The browser counts it across every keepalive request of the page, so the separate Segment path does not get its own room. The order is: Spans get 16 KB, Logs use what they need of the rest, and an unsent Segment gets what Logs leave, up to 32 KB. A Segment that does not fit whole is dropped, and the gap shows in `everr.recording.segment.index`. A Clip never takes room from Spans or Logs.
- No retry. A failed request is dropped; the gap shows in `everr.recording.segment.index`.
- **Host `send`.** With the WebSDK `send` option, each Segment is one `send("logs", body)` call, with `body` the plain JSON string. The WebSDK does not gzip for a host: `send` takes a string and has no headers, so the host compresses if it wants to. The keepalive budget does not apply to a host, so the exit flush sends unsent Segments in full.

### Emitted names

| Name | Kind | Value |
|---|---|---|
| `everr.browser.recording.segment` | event name | one per Segment; the collector routing key |
| `everr.browser.recording.mark` | event name | one per `markRecording()` call; stored in `logs` |
| `everr.recording.mark.name` | log attr | the mark name |
| `everr.recording.stream.id` | attr | random id per document per Session; on the envelope while the Stream buffers |
| `everr.recording.clip.id` | attr | random id per Clip; on Segments and the `recording` span |
| `everr.recording.clip.truncated` | attr | `true` when the Clip starts later than requested |
| `everr.recording.segment.index` | log attr | int from 0 per Clip; a gap is a lost request |
| `everr.recording.trigger` | span attr | `error`, `network`, or `manual` |
| `recording` | span name | one root span per Clip, covering its range |

The envelope (`session.id`, `everr.page_view.id`, URL, route, `user.*`, and `everr.recording.stream.id` while a Stream buffers) is written as on every other record. There is no marker attribute `everr.recording`. Every Segment already has the event name, so the collector routes on that, and the `everr.recording.*` namespace stays for the attributes in the table. All new names go into the browser events catalog in the telemetry skill. That catalog calls a manual `tracer.startSpan()` a span, not a Segment.

### Ingestion and storage

- **Cloud collector.** Logs whose event name is `everr.browser.recording.segment` are routed to their own ClickHouse exporter, which writes `otel.otel_recordings`: `ENGINE = Null`, same columns as `otel.otel_logs`. The split is a `routingconnector`, which `collector/config/manifest.yaml` adds next to `everrusageconnector`. The usage processor stays in front of the split, so a Segment is counted once and not again after routing. Each Segment counts its encoded size, like any log, against the shared quota.
- The recordings exporter uses a small item-count batch (`sending_queue.batch` with `max_size` about 16, so at most about 15 MB of bodies) and a `flush_timeout` of about one second. The ClickHouse exporter has no byte-size batch, so the row count is the limit. Copying the logs pipeline's 8192-row batch onto 950 KB bodies is the failure mode to avoid, as are tiny parts.
- `app.recordings_mv` reads `otel.otel_recordings`, stamps `tenant_id` and `retention_days` as `app.logs_mv` does, and projects `session_id` from `session.id`, `stream_id` from `everr.recording.stream.id`, and `clip_id` from `everr.recording.clip.id`. It is not attached to `otel.otel_logs`.
- `app.recordings` schema:
  - the `app.logs` columns plus `session_id String`, `stream_id String`, and `clip_id String`;
  - body is a `String` with ZSTD compression (an opaque rrweb JSON string; `app.logs` already compresses `Body` with ZSTD);
  - `ORDER BY (tenant_id, ServiceName, Timestamp)`;
  - `PARTITION BY (toDate(Timestamp), retention_days)` with `ttl_only_drop_parts = 1` and the same TTL as `app.logs`;
  - bloom filter skip indexes on `session_id`, `stream_id`, and `clip_id`;
  - no lower-body index and no snapshot, URL, or error-count columns. The rrweb payload is the source of truth.
- Mirror `tenant_filter_logs` and `sql_api_default_deny_logs` onto `app.recordings`. Do not grant it to the SQL API role and do not add it to the SQL API tenant table list, so it stays out of the MCP tool description.
- The ClickHouse init scripts only run on a fresh server, so existing clusters need the matching manual DDL.
- **Local Collector.** No Null table and no view. The chdb exporter writes a local recordings table with the same payload columns as local `logs`, plus `session_id`, `stream_id`, `clip_id`, and their bloom filters. The split key is the same event name; the local collector has no routing connector, so the chdb exporter splits by event name itself. Local `logs` has no `tenant_id`, and this table does not add one.

### Player read

- A browser entry (a browser Span of any kind, or a browser error log) uses its own `session.id`. A backend entry uses the `session.id` on the browser Client spans of its Trace. Every Client span in the Trace must agree; a backend entry whose Trace has no Client span, or disagreeing ones, has no Session. `session.id` is not propagated to backend services.
- The player reads `everr.recording.stream.id` from a browser record: the entry when it is a browser Span or a browser error log, otherwise the browser Client spans of the entry's Trace (the same spans that give the Session). Those Client spans must agree on the stream id too; if they disagree, the entry has no Clip. A backend Span never carries the stream id, because the envelope is not propagated.
- **Choosing the Clip.** The player queries `traces` for `SpanName = 'recording'` with that `session.id` and stream id, and takes the spans whose range covers the entry time. If several do, it takes the one with the earliest start (the most context). If none does, it shows "no clip at this moment" and lists the Session's Clips, from the same query without the stream and time filters, as links that open each one.
- **Loading the Clip.** The player loads the whole Clip. Cloud and local use the same predicate, with no `tenant_id` in the query: `WHERE ServiceName = ? AND Timestamp BETWEEN ? AND ? AND session_id = ? AND clip_id = ?`. The window is the span's range, with its start moved 60 seconds earlier for the snapshot lead-in. `ServiceName` is the browser service, taken from the record that gave the stream id. On Cloud, tenant isolation is the `app_ro` row policy on `app.recordings` (the same shape as `tenant_filter_logs`). The local table has no `tenant_id` column. Do not add `tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))`. Segments are ordered by `everr.recording.segment.index`. `clip_id` keeps overlapping Clips and other tabs apart.
- The replayer matches the recorder's rrweb version.
- `everr.page_view.id` does not choose a Clip. The player seeks to the timestamp of the entry, and the page view only tells the UI which SPA view the moment belongs to.

### Player UI

From the prototype (Stage layout, `prototype/replay-player` branch):

- The player is the top of the Trace view and the error view. It shows one Clip, chosen as Player read describes.
- Under it, the existing trace view: waterfall, span details, filters, flamegraph. There is no second timeline. The waterfall keeps the trace `Events` column, and also draws Logs and errors joined from `logs` on `TraceId` and `SpanId`. A log with no span id is not on the waterfall. The error view still shows it, and the player seeks by its timestamp.
- Clicking a Span seeks the player to that Span. While playing, the selected row is the Span under the clock.
- A Trace opens on the Span you came from. An error opens on the Span that carries the exception log when that log has a span id; otherwise it opens at the log's timestamp. The stack is `exception.stacktrace` on that log.
- When no Clip covers the moment, the player area keeps a "no clip at this moment" message with links to the Session's Clips; the trace view still works. A Trace with no Session has no player.
- The player shows the requested start, the trigger moment of an automatic Clip (the `recording` span's trigger and its `next`), truncation, paused ranges, and gaps in the Segment index.

### Agent access

- No new CLI command and no new MCP tool. Agents use `query` against Logs and Traces: a window around the entry time when it has one, otherwise the latest rows.
- Agents find Clips through the `recording` span and marks through `everr.browser.recording.mark` logs. They do not read `app.recordings`; the telemetry skill says the rows are rrweb and the wrong payload for an Agent.

## Testing Decisions

A good test drives the feature through a public boundary and asserts on what crosses the next one: OTLP requests out of the WebSDK, rows out of the collector, rendered UI and issued queries in the app. Tests do not reach into rrweb internals, buffer state variables, or MV definitions.

Three seams, each reusing existing test infrastructure:

1. **WebSDK OTLP output.** A `WebSDK` with `recording()` (plus `errors()` and `network()` where a trigger needs them) in jsdom, with the transport fetch stubbed and the captured batches decoded by the existing test kit. Drive DOM changes, errors, 5xx and failed requests, `emitRecording` / `markRecording` / `pauseRecording` / `resumeRecording`, Session rotation, and page hide. Assert on:
   - nothing is sent until a Clip is emitted;
   - `last`, `since` (mark and timestamp), the whole buffer, and `next`: the Clip's first full snapshot is at or before the requested start, and its events end at the call or after `next`;
   - truncation when the start has left the buffer, and the 10 MB cap dropping the oldest events;
   - automatic Clips: 60 seconds plus a 10 second tail, triggers inside a tail extend it up to 60 seconds, the sixth automatic Clip in a Session is not sent, manual Clips are not capped, filtered errors and 4xx responses send nothing;
   - two overlapping Clips each carry the shared events, with different clip ids;
   - Segment attributes, envelope, index from 0 per Clip, and the 950 KB close;
   - Masked, Blocked, and Ignored content in the body under `dev` true and false, markers, selector options, `unmask` / `unblock` precedence, passwords, and file inputs;
   - sampling: the same decision across a reload and a second tab of one Session, and over a sweep of Session ids the share matches `sampleRate`; in an unsampled Session, `emitRecording()` sends nothing and `markRecording()` still sends its mark log;
   - pause: no events from the paused range, and a full snapshot on resume;
   - Segments do not extend the Session: a Session with only Clip traffic ends after 30 idle minutes;
   - Session rotation during a page: a Clip emitted after it has only events of the new Session and a new stream id;
   - gzip on normal sends and plain JSON on exit; at exit, Logs fit before an unsent Segment, the Segment gets only what Logs leave (up to 32 KB) or is dropped whole, and Spans and Logs are never cut for it;
   - with a host `send`: one plain JSON string per Segment, no gzip, and unsent Segments in full at exit;
   - one `recording` span per Clip: a trace root covering the requested start to the Clip end, with clip id, stream id, trigger, and truncation, emitted when the Clip completes or in the exit flush, and no later request or log has it as a parent.
   Prior art: the WebSDK, self-export, and built-in instrumentation tests. jsdom cannot check layout, so the size of a Block placeholder, real playback, and responsiveness on a heavy page are checked by hand against the local app and the local Collector.
2. **Collector: OTLP in, rows out.** Send OTLP logs with event names `everr.browser.recording.segment`, `everr.browser.recording.mark`, and others. Assert Segment rows land in the recordings table with `session_id`, `stream_id`, and `clip_id`, never in logs; mark logs and ordinary logs land in logs. Local: the chdb smoke test against the built local collector. Cloud: the ClickHouse exporter integration tests on testcontainers, extended to cover `otel.otel_recordings` through `app.recordings_mv` into `app.recordings`, with stamped tenant and retention. Prior art: the chdb smoke tests and the exporter integration tests.
3. **Trace and error detail routes.** The app routes with the ClickHouse client mocked at `execute`. Assert: the player shows above the trace view when a Clip covers the entry; the earliest-starting Clip wins when several do; "no clip at this moment" with links when none does; no player without a Session; Span click seeks; the Segment query is scoped to service, Session, Clip, and window and does not filter on `tenant_id`; the stream id comes from the entry or, for a backend entry, from the Trace's browser Client spans, with the browser `ServiceName`. Prior art: the existing trace detail and error detail route tests and the trace repository tests.

Also, on existing tests rather than new seams:

- The SQL API tenant table list test and the MCP query tool description test get a negative assertion: `recordings` is not in `SQL_API_TENANT_TABLES` and not in `QUERY_TOOL_DESCRIPTION`. Today they only check that listed tables are documented.
- The trace list leaves out root spans named `recording`.
- CORS: a preflight with `Access-Control-Request-Headers: content-encoding` against the built local collector is allowed. This tests the behaviour, not the YAML text.
- size-limit budgets for the `recording()` stub and the recorder chunk, checked with `pnpm size`.
- Per the project rules, ingestion is verified end to end with Everr: emit a Clip and a mark from a local page, then query the `recording` span, the mark log, and the recordings table with the local Collector.

## Out of Scope

- Recording a whole Session from start to end. Clips only.
- PR verification evidence from Clips. Its own effort later; the format (rrweb events intact, Segments in order) does not block it.
- Generating e2e tests from Clips. Its own effort later; same format note.
- Agent page read: accessibility snapshot, diff, or screenshot at one moment of a Clip, where its renderer runs, and how accessible names with personal data are Masked. The format does not block it.
- Video or screenshot capture. DOM recording only.
- A Session list or summary table. Listing Sessions with a Clip is a `traces` query on the `recording` span.
- A `to` mark that closes a Clip at a later mark.
- Removing duplicate events between overlapping Clips.
- Alerts that list the Sessions they hit.
- Deleting Recordings on request, per Visitor or Session.
- Propagating `session.id` to backend services.
- Custom handling for cross-origin iframes, canvas, and shadow DOM beyond what rrweb does.

## Further Notes

- Glossary terms used here (Recording, Stream, Clip, Segment, Replay, Mask, Block, Ignore, Session) are defined in `CONTEXT.md`. Prefer them; avoid "session replay" for the data.
- Known limits to document: `dev: true` outside a developer's machine sends unmasked content; `emitRecording()` does nothing in an unsampled Session; a CSS `background-image` is not Blocked; rrweb has no mutation cap, so a page with very many DOM changes costs more CPU; a full page load or reload document request is its own Trace and has no Session; a cross-origin request that does not send `traceparent` is its own Trace; cron, webhooks, and other Traces with no browser Client span have no Session and no player.
- Volume reference from prior art: 13 KB/min gzip for a small SPA, up to 650 KB/min for a heavy SPA with navigations; a full snapshot is about 100 to 120 KB raw. The 10 second snapshot interval puts up to 6 snapshots in a 60 second Clip; measure Clip sizes on the dev app before release, and consider sending only the snapshots a Clip needs as a follow-up.
- Raw rrweb costs an Agent about 270k tokens per minute, which is why the Agent surface is the text timeline.
- Prior art and research: `research/recorder-prior-art` and `research/agent-consumable-replay` branches. Player layout prototype: `prototype/replay-player` branch, route `/replay-prototype` (variant A, Stage, is the chosen one).
