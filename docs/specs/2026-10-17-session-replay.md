# Session Replay

**Date:** 2026-10-17
**Labels:** ready-for-agent

## Problem Statement

When something goes wrong in a web app, a developer looks at a failing Trace or an error in Everr and has to guess what the person on the page did and saw. The Traces, Logs, and errors show what the system did. They do not show the screen: which button was clicked, what the page looked like, whether a spinner stayed forever, whether the error was even visible. The developer asks the reporter for screenshots, tries to reproduce the issue by hand, and often cannot.

Agents have the same gap. An Agent investigating a problem can read Logs and Traces, but it cannot tell what the person did between them.

## Solution

The WebSDK gets a replay Instrumentation, `recording()`, that records the DOM of a Session with rrweb. A Recording is sent as OTLP Logs, routed by the collector into its own ClickHouse table, and stored with the Plan retention, both in the Cloud and in the local Collector.

A developer debugging a problem opens a Trace or an error. If that Trace has a Session, a Replay player sits at the top of the view, opened at the matching moment. Under it is the existing trace view. Clicking a Span seeks the player to that moment; while the player plays, the Span under the clock is selected. The error's stack stays `exception.stacktrace` on the exception log, which the error view already renders. Logs and errors that have a `TraceId` and a `SpanId` are drawn on that waterfall by a join from `logs`. They are not OTel span events: `addEvent` and `recordException` record nothing on this tracer.

When the WebSDK `dev` option is not true, the recorder keeps the last 30 to 60 seconds in memory and sends them when an error or a failed request happens, then keeps recording. When `dev` is true, every Session is recorded from the start. `dev` is that option, not the build and not the Local or Production origin. The privacy bundle is on when `dev` is not true: all text and inputs are Masked and media is Blocked. Integrators tune this with options and markers.

Agents use the `query` tool they already have. They read the Session's Logs and Traces as a text timeline, and find Recordings through one `recording` span per Stream. Agents never read the raw rrweb payload.

## User Stories

### Developer debugging a Session

1. As a developer debugging a problem, I want to open a Trace and see the Recording of the Session that produced it, so that I can see what the person did and saw.
2. As a developer, I want the player to open at the moment of the Span I came from, so that I do not have to scrub through the Recording.
3. As a developer, I want to open an error and see the Recording at the moment of the Span that carries that error, so that I can see the screen when it failed.
4. As a developer, I want the error's stack to remain visible as `exception.stacktrace` on the exception log, so that the Replay adds to the error view instead of replacing it.
5. As a developer, I want the existing waterfall, span details, filters, and flamegraph under the player, so that I keep the tools I already use.
6. As a developer, I want to click a Span and have the player seek to it, so that I can jump between what the system did and what the screen showed.
7. As a developer, I want the selected Span to follow the player clock while it plays, so that I can see which request belongs to which screen change.
8. As a developer, I want Logs and errors that share a `TraceId` and `SpanId` with a Span drawn on the waterfall, so that I have one timeline instead of two. A log with no span id stays off the waterfall.
9. As a developer, I want a backend Trace (a server function, a same-origin API call, a cross-origin call that sends `traceparent`) to open the Recording of the browser Session that caused it, so that backend problems also get a Replay.
10. As a developer, I want the player area to say the Session has no Recording when it was not sampled, so that I know the absence is expected and not a bug.
11. As a developer, I want no player at all on a Trace with no Session (cron, webhooks, a full page load document request), so that the view stays clean when Replay cannot apply.
12. As a developer, I want the player to show only the Stream of the document I came from, so that a second tab in the same Session does not confuse the Replay. An SPA navigation stays in that Stream.
13. As a developer, I want to see where the Recording came from the on-error buffer, so that I know the part before the trigger was captured before anything went wrong.
14. As a developer, I want to see a gap where a Segment was lost, so that I do not mistake missing data for the page doing nothing.
15. As a developer, I want the Replay to load quickly for a moment deep inside a long Session, so that I do not wait for the whole Recording to download.
16. As a developer working locally, I want Replay to work against the local Collector exactly as it does in the Cloud, so that I can debug Sessions on my machine.
17. As a developer, I want to find Sessions that have a Recording with a `traces` query on the `recording` span, so that I can list or search Recordings without a dedicated view.

### Integrator setting up the WebSDK

18. As an integrator, I want to add recording with one Instrumentation, `recording()`, so that setup matches the other Instrumentations.
19. As an integrator, I want `recording()` to come from its own subpath, `@everr/otel-web/recording`, so that apps that do not record pay no bundle cost.
20. As an integrator, I want the recorder code to load only when the Session is sampled, so that unsampled Sessions download nothing extra.
21. As an integrator, I want not to install rrweb myself, so that the WebSDK owns the recorder version.
22. As an integrator, I want `sessionSampleRate` to set the share of Sessions recorded from the start, so that I control cost.
23. As an integrator, I want `sessionSampleRate` to default to 1 when the WebSDK `dev` option is true and to 0 otherwise, so that a `dev` SDK records every Session and any other SDK records nothing until an error.
24. As an integrator, I want `errorSampleRate` to default to 1, so that every Session with an error gets a Recording around that error by default.
25. As an integrator, I want the sampling decision to be the same across tabs and reloads of a Session, so that a Recording is not split by sampling.
26. As an integrator, I want an error captured by the WebSDK (unhandled error, rejection, React boundary, manual capture) to trigger the on-error buffer, so that I see what led to it.
27. As an integrator, I want a request with a 5xx response or no response to trigger the on-error buffer when `network()` is installed, so that failed requests get a Recording too.
28. As an integrator, I want a 4xx not to be a trigger, so that validation errors do not fill my quota.
29. As an integrator, I want errors removed by the `errors()` `ignore` and `denyUrls` filters not to trigger recording, so that filtered noise stays filtered.
30. As an integrator, I want `startRecording()` to switch the current Session to full recording, whatever the rates, so that I can record a flow I care about.
31. As an integrator, I want `stopRecording()` to stop sending for the current Session, so that I can stop recording a sensitive flow.
32. As an integrator, I want a later `startRecording()` in the same Session to continue the same Recording with a gap, so that one Session still has one Recording.
33. As an integrator, I want a documented warning that wrapping `recording()` in `sampled()` multiplies the rates, so that I am not surprised by fewer Recordings.
34. As an integrator, I want a new Session during a page to start a new Recording with new sampling decisions, so that Sessions and Recordings stay one to one.
35. As an integrator, I want Recordings to count against the same telemetry quota as everything else, so that there is no second limit to manage.
36. As an integrator on Hobby or Pro, I want Recordings to work on both Plans with the Plan retention, so that recording is not a separate purchase.

### Integrator controlling privacy

37. As an integrator, I want all text Masked by default when the privacy bundle is on, so that personal data on screen is not stored.
38. As an integrator, I want all input values Masked by default when the privacy bundle is on, so that form contents are not stored.
39. As an integrator, I want `title`, `placeholder`, and `aria-label` Masked by default when the privacy bundle is on, so that attributes do not leak what text Masking hides.
40. As an integrator, I want password inputs always Masked, even with `maskAllInputs` off or under `unmask`, so that a password never reaches storage.
41. As an integrator, I want media (`img`, `svg`, `video`, `object`, `picture`, `embed`, `map`, `audio`, icon links) Blocked by default when the privacy bundle is on, so that images of people and documents are not stored.
42. As an integrator, I want a Blocked element to keep its size, so that the layout in the Replay still makes sense.
43. As an integrator, I want file inputs Ignored, so that file selection is not recorded.
44. As an integrator, I want the privacy bundle off when the WebSDK `dev` option is true, so that I see my own page as it is while developing.
45. As an integrator, I want explicit options to win over the defaults whether or not the WebSDK `dev` option is true, so that I can tune either.
46. As an integrator, I want the `everr-mask`, `everr-block`, and `everr-ignore` classes and the matching `data-everr-*` attributes, so that I can mark elements in markup.
47. As an integrator, I want `mask`, `unmask`, `block`, `unblock`, and `ignore` selector options that add to the markers, so that I can mark elements I do not control.
48. As an integrator, I want `unmask` to win over Mask and `unblock` to win over Block, so that I can reveal safe areas like navigation.
49. As an integrator, I want `maskFn` to replace the asterisk substitution, so that I can choose how Masked text looks.
50. As an integrator, I want `maskAttributes` to choose which attributes are Masked, so that I can cover custom attributes that carry personal data.
51. As an integrator, I want option names that match Sentry's, so that migrating from Sentry is mechanical.
52. As an integrator, I want Masking to happen in the browser before a Segment is built, so that unmasked data never leaves the page.
53. As an integrator, I want Cookieless and Consented modes to use the same privacy rules, so that consent mode does not change what is recorded.

### End user of an integrator's app

54. As a person using an app with recording, I want the page to stay responsive, so that recording does not degrade my experience.
55. As a person leaving a page, I want the exit flush to stay small, so that recording does not crowd out the app's own telemetry.

### Agent

56. As an Agent, I want to read a Session's timeline from Logs and Traces with the existing `query` tool, so that I need no new tool to understand a problem.
57. As an Agent, I want to find a Recording by filtering `traces` for `SpanName = 'recording'` and `session.id`, so that I can tell a developer a Replay exists.
58. As an Agent, I want `everr.recording.trigger` on the `recording` span, so that I know why the Stream was recorded.
59. As an Agent, I want the telemetry skill to tell me the recordings table holds rrweb and is the wrong payload, so that I do not waste tokens on it.
60. As an Agent, I want a window around the entry time when the entry has a time, and the latest rows otherwise, so that my read stays small.

### Everr operator

61. As an Everr operator, I want Recordings in their own table, so that a bad Recording batch cannot fail an ordinary log insert.
62. As an Everr operator, I want Recordings partitioned by day and retention, so that a Plan change drops whole parts.
63. As an Everr operator, I want Recording inserts batched by bytes, so that ClickHouse does not get tiny parts or huge 8192-row batches of 950 KB bodies.
64. As an Everr operator, I want `app.recordings` off the SQL API grant list with a default-deny row policy, so that tenants and Agents cannot query raw rrweb through the SQL API.
65. As an Everr operator, I want a Recording to count once against usage, so that billing is correct.

## Implementation Decisions

### Capture: the replay Instrumentation (WebSDK)

- `recording()` is a factory exported from the new subpath `@everr/otel-web/recording`. The main entry does not change, so its size budgets do not change. size-limit gets two new lines: the `recording()` stub and the recorder chunk.
- The stub decides sampling and calls `import()` for the recorder chunk only when the Session is sampled (session mode or on-error mode). This is the first dynamic import in the WebSDK, so the build must emit the recorder as its own chunk.
- **Cost of the defaults.** On-error mode counts as sampled, and `errorSampleRate` defaults to 1. So with the defaults every Session loads the recorder chunk (about 23 KB gzip) and runs rrweb's observers for the life of the page, even when no error happens. This is the price of having the 30 to 60 seconds before an error; Sentry makes the same trade. An integrator who wants no recorder cost on most Sessions lowers `errorSampleRate`. Unsampled Sessions, the ones story 20 is about, are the Sessions both rates leave out.
- The recorder is upstream `@rrweb/record`, bundled into the chunk at an exact pinned version (checked against `rrweb@2.1.7`). It is about 23 KB gzip. Integrators do not install it.
- Options, all at the top level. Transport limits, flush interval, buffer length, and snapshot interval are not options.

  ```ts
  recording({
    sessionSampleRate, // 1 when dev is true, otherwise 0
    errorSampleRate,   // default 1
    maskAllText, maskAllInputs, blockAllMedia,
    mask, unmask, block, unblock, ignore, maskFn, maskAttributes,
  })
  ```

- Each rate is decided once per Session with the same hash `sampled()` uses, over the Session id plus the rate name, so every tab and reload of a Session decides the same way. An outer `sampled()` multiplies with these rates; this is documented, not prevented.
- **Modes.** A Stream is in one of: not recording, buffering (on-error), or session mode. `startRecording()` forces session mode. `stopRecording()` stops sending for the current Session. Both are exported from `@everr/otel-web/recording`, the same kind of export as `identify` and `captureError`. They affect the recording instrumentation on the current page. `recording()` returns only the teardown `WebSDK` calls on shutdown. Integrators do not call that return value.
- **On-error buffer.** The rrweb two-window recipe with a checkout every 30 seconds, so the buffer holds 30 to 60 seconds before the trigger. On a trigger the buffer is sent and the Stream switches to session mode until the Session ends.
- **Triggers** reach the Instrumentation through internal seams; `InstrumentationContext` gets no new public member:
  - any error on the shared capture path, after the `errors()` `ignore` and `denyUrls` filters;
  - a `network()` span with a 5xx response or no response (fetch rejects, XHR `error` or `timeout`). A 4xx is not a trigger. `recording()` does not patch fetch itself.
- **Streams.** One Stream per document per Session. Each Stream has a random `everr.recording.stream.id`. A Recording has one or more Streams; two tabs of one Session give two Streams at once.
- **Stream id on the envelope.** For the life of a Stream (buffering or session mode), the instrumentation sets ambient `everr.recording.stream.id` through the same set as `setAttributes`, and clears it when the Stream ends. The envelope copies that set onto every later log and span. SPA navigation rotates `everr.page_view.id` and leaves the stream id in place. A hard navigation starts a new document, so it starts a new Stream.
- **Snapshots.** In session mode, a full snapshot every 5 minutes, so a Replay read for any moment never needs more than the 5 minutes before it.
- **Session change.** When the Session id changes during a page, the current Stream ends, rates are decided again, and a new Stream starts with a full snapshot in a new Recording. This is the one case where one document has two Streams, one after the other. `sampled()` decides once at setup and never decides again, so `recording()` keeps its own per-Session decision and does not reuse the `sampled()` wrapper. There is no maximum length; the 30-minute idle end and the rates bound cost.
- **`recording` span.** One short internal span per Stream that has sent a Segment, named `recording`. It is created with `startSpan` and `root: true` when the first Segment is sent, then ended immediately, so `emitSpan` exports it while the Stream continues. `startSpan` does not join the active stack, so clicks, requests, and logs do not become its children. `startActiveSpan` would, including with `root: true`, and a span that lasts until the Stream ends is invisible until `end()` and would parent every later request. A Stream that is only buffering has no span and is not a Recording. The span carries the envelope, `everr.recording.stream.id`, and `everr.recording.trigger`. Agents find Recordings with it. The player reads the stream id from the entry and does not use this span's short window as the Recording's window.
- **No span ids inside the Recording.** The Recording joins the other signals by `session.id`, `everr.recording.stream.id`, and time. `everr.page_view.id` seeks inside the Stream. No custom rrweb events carry span ids.

### Privacy layer

- Runs in the browser, before a Segment is built. No scrub in the collector. Cookieless and Consented modes use the same rules.
- One default bundle chosen by the WebSDK `dev` option: on when `dev` is not true, off when `dev` is true. Explicit options win in both cases. The markers and selector options always apply.
- When the bundle is on: Mask all text and inputs; Mask `title`, `placeholder`, and `aria-label`; Block media (`img`, `svg`, `video`, `object`, `picture`, `embed`, `map`, `audio`, icon links), `base`, and same-origin `srcdoc` iframes; Ignore file inputs. A CSS `background-image` is not Blocked.
- Passwords stay Masked with `maskAllInputs: false` and under `unmask`. `unblock` does not reveal a password.
- Markers always in the selector lists: `everr-mask`, `everr-block`, `everr-ignore`, and the matching `data-everr-*` attributes. `unmask` wins over Mask; `unblock` wins over Block.
- Mapping onto rrweb options, decided against `rrweb@2.1.7`:
  - all text: `maskTextSelector: "*"`, with `maskTextFn` returning the text unchanged under `unmask` and otherwise applying `maskFn` or the asterisk substitution;
  - inputs: `maskInputFn`, which keeps passwords Masked in every case;
  - Block: `blockSelector`, with `unblock` expressed as `:not(...)` because rrweb matches each element on its own. rrweb does not record the children of a Blocked element, so `unblock` cannot reveal an element inside a Blocked parent; unblock the parent instead;
  - Ignore: `ignoreSelector`;
  - `maskAttributes`: rrweb has no hook, so the `emit` callback rewrites those attributes in full-snapshot nodes and attribute mutations before the Segment is built. No rrweb fork.
- Not taken from Sentry: network body capture, server-side scrub, the canvas plugin. Cross-origin iframes, canvas, and shadow DOM behave as rrweb records them; the docs describe that behaviour, with no custom handling.

### Transport

- A Segment is one OTLP Log on the existing logs emitter. Event name `everr.browser.recording.segment`. Body: the rrweb events as JSON.
- A Segment closes every 5 seconds, or when its JSON reaches about 950 KB. Each Segment is sent on its own request through the logs send path, but not through the shared logs queue.
- The WebSDK gzips a request with `CompressionStream` (`Content-Encoding: gzip`) when the browser supports it and the page is not in the exit flush. If gzip is missing or fails, the request is plain JSON. This applies to all WebSDK requests, not only Segments. `Content-Encoding` is not a CORS-safelisted request header, and browser ingest is cross-origin. The same change adds `Content-Encoding` to every browser OTLP CORS allow-list: `allowed_headers` in `collector/config.example.yml` and `collector/config.yml`, and the `cors` block in `collector/internal/localgateway/config/config.go` (that block sets `allowed_origins` only, so rs/cors allows simple headers only). Without those headers, the preflight fails and ordinary log and span export stops.
- Exit flush (page hide, page becoming hidden): the keepalive budget stays 64 KB. The browser counts it across every keepalive request of the page, so the separate Segment path does not get its own room. The order is: Spans get 16 KB, Logs use what they need of the rest, and the open Segment gets what Logs leave, up to 32 KB. A Segment that does not fit whole is dropped, and the gap shows in `everr.recording.segment.index`. A Recording never takes room from Spans or Logs.
- No retry. A failed request is dropped; the gap shows in `everr.recording.segment.index`.
- **Host `send`.** With the WebSDK `send` option, each Segment is one `send("logs", body)` call, with `body` the plain JSON string. The WebSDK does not gzip for a host: `send` takes a string and has no headers, so the host compresses if it wants to. The keepalive budget does not apply to a host, so the exit flush sends the open Segment in full.

### Emitted names

| Name | Kind | Value |
|---|---|---|
| `everr.browser.recording.segment` | event name | one per Segment; the collector routing key |
| `everr.recording.stream.id` | attr | random id per document; on the envelope while the Stream exists |
| `everr.recording.segment.index` | log attr | int from 0 per Stream; a gap is a lost request |
| `everr.recording.trigger` | attr | `session`, `error`, `network`, or `manual` |
| `recording` | span name | one short root span, emitted when the first Segment of the Stream is sent |

The envelope (`session.id`, `everr.page_view.id`, URL, route, `user.*`, and `everr.recording.stream.id` while a Stream exists) is written as on every other record. There is no log attribute `everr.recording`. ClickHouse stores attributes in a `JSON` column and treats a dot as a nested path, so a scalar `everr.recording` next to any `everr.recording.*` key is a duplicate path and the insert fails. All new names go into the browser events catalog in the telemetry skill. That catalog calls a manual `tracer.startSpan()` a span, not a Segment.

### Ingestion and storage

- **Cloud collector.** Logs whose event name is `everr.browser.recording.segment` are routed to their own ClickHouse exporter, which writes `otel.otel_recordings`: `ENGINE = Null`, same columns as `otel.otel_logs`. The usage processor stays in front of the split, so a Recording counts once against the shared quota.
- The recordings exporter batches by bytes and flushes about once a second. Copying the logs pipeline's 8192-row batch onto 950 KB bodies is the failure mode to avoid, as are tiny parts.
- `app.recordings_mv` reads `otel.otel_recordings`, stamps `tenant_id` and `retention_days` as `app.logs_mv` does, and projects `session_id` from the log attribute `session.id`. It is not attached to `otel.otel_logs`.
- `app.recordings` schema:
  - the `app.logs` columns plus `session_id String`;
  - body is a `String` with ZSTD compression (an opaque rrweb JSON string; `app.logs` already compresses `Body` with ZSTD);
  - `ORDER BY (tenant_id, ServiceName, Timestamp)`;
  - `PARTITION BY (toDate(Timestamp), retention_days)` with `ttl_only_drop_parts = 1` and the same TTL as `app.logs`;
  - a bloom filter skip index on `session_id`;
  - no lower-body index and no snapshot, URL, or error-count columns. The rrweb payload is the source of truth.
- Mirror `tenant_filter_logs` and `sql_api_default_deny_logs` onto `app.recordings`. Do not grant it to the SQL API role and do not add it to the SQL API tenant table list, so it stays out of the MCP tool description.
- The ClickHouse init scripts only run on a fresh server, so existing clusters need the matching manual DDL.
- **Local Collector.** No Null table and no view. The chdb exporter writes a local recordings table with the same payload columns as local `logs`, plus `session_id` and its bloom filter. The split key is the same event name. Local `logs` has no `tenant_id`, and this table does not add one.

### Replay read

- A Trace's Session is the `session.id` on its browser Client spans. Every Client span in the Trace must agree; a Trace with no Client span, or with disagreeing ones, has no Session. A browser error or browser Span opens its Session directly. `session.id` is not propagated to backend services.
- The player reads `everr.recording.stream.id` from a browser record: the entry when it is a browser Span or a browser error log, otherwise the browser Client spans of the entry's Trace (the same spans that give the Session). A backend Span never carries the stream id, because `session.id` and the envelope are not propagated. That id is the Stream. It does not match a Stream by `everr.page_view.id`. `everr.page_view.id` seeks inside the Stream.
- An entry with a Session and no stream id has no Recording. A stream id alone does not prove a Recording: a Stream that only buffered, or one stopped before its first Segment, puts the id on records and sends nothing. The player shows a Recording only when the `recording` span for that stream id exists; otherwise it shows the "no Recording" state.
- It loads that Stream's Segments starting at most 5 minutes before the target moment. Cloud and local use the same predicate, with no `tenant_id` in the query: `WHERE ServiceName = ? AND Timestamp BETWEEN ? AND ? AND session_id = ?`. `ServiceName` is the browser service, taken from the record that gave the stream id, not from the entry when the entry is a backend Span. On Cloud, tenant isolation is the `app_ro` row policy on `app.recordings` (the same shape as `tenant_filter_logs`). The local table has no `tenant_id` column. Do not add `tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))`. Segments are filtered to the Stream and ordered by time and `everr.recording.segment.index`. The player does not wait for the `recording` span to end.
- The replayer matches the recorder's rrweb version.

### Replay UI

From the prototype (Stage layout, `prototype/replay-player` branch):

- The player is the top of the Trace view and the error view. It shows one Stream: the document the entry belongs to, from `everr.recording.stream.id` as Replay read describes.
- Under it, the existing trace view: waterfall, span details, filters, flamegraph. There is no second timeline. The waterfall keeps the trace `Events` column, and also draws Logs and errors joined from `logs` on `TraceId` and `SpanId`. A log with no span id is not on the waterfall. The error view still shows it, and the player seeks by its timestamp.
- Clicking a Span seeks the player to that Span. While playing, the selected row is the Span under the clock.
- A Trace opens on the Span you came from. An error opens on the Span that carries the exception log when that log has a span id; otherwise it opens at the log's timestamp. The stack is `exception.stacktrace` on that log.
- A Session with no Recording keeps the player area with a "no Recording" message; the trace view still works. A Trace with no Session has no player.
- The part of a Stream that came from the buffer (before the trigger) and gaps in the Segment index are visible in the player.

### Agent access

- No new CLI command and no new MCP tool. Agents use `query` against Logs and Traces: a window around the entry time when it has one, otherwise the latest rows.
- Agents find Recordings through the `recording` span. They do not read `app.recordings`; the telemetry skill says the rows are rrweb and the wrong payload for an Agent.

## Testing Decisions

A good test drives the feature through a public boundary and asserts on what crosses the next one: OTLP requests out of the WebSDK, rows out of the collector, rendered UI and issued queries in the app. Tests do not reach into rrweb internals, mode state variables, or MV definitions.

Three seams, each reusing existing test infrastructure:

1. **WebSDK OTLP output.** A `WebSDK` with `recording()` (plus `errors()` and `network()` where a trigger needs them) in jsdom, with the transport fetch stubbed and the captured batches decoded by the existing test kit. Drive DOM changes, errors, 5xx and failed requests, `startRecording` / `stopRecording`, Session rotation, and page hide. Assert on:
   - whether Segments are sent, given rates, triggers, and manual control;
   - Segment attributes, envelope, index sequence, and the 5 second / 950 KB close;
   - Masked, Blocked, and Ignored content in the body under `dev` true and false, markers, selector options, `unmask` / `unblock` precedence, and passwords;
   - gzip on normal sends and plain JSON on exit; at exit, Logs fit before the open Segment, the Segment gets only what Logs leave (up to 32 KB) or is dropped whole, and Spans and Logs are never cut for it;
   - with a host `send`: one plain JSON string per Segment, no gzip, and the open Segment in full at exit;
   - Session rotation during a page: the Stream ends and a new Stream with a new stream id starts, with rates decided again;
   - one short `recording` span per Stream that sent a Segment, created with `startSpan` and `root: true`, ended when that first Segment is sent, and not a parent of later requests or logs. A Stream that only buffered has no span.
   Prior art: the WebSDK, self-export, and built-in instrumentation tests. jsdom cannot check layout, so the size of a Block placeholder and real playback are checked by hand against the local app and the local Collector.
2. **Collector: OTLP in, rows out.** Send OTLP logs with and without event name `everr.browser.recording.segment`. Assert Recording rows land in the recordings table with `session_id`, never in logs, and ordinary logs are unaffected. Recording rows do not carry a scalar `everr.recording` attribute. Local: the chdb smoke test against the built local collector. Cloud: the ClickHouse exporter integration tests on testcontainers, extended to cover `otel.otel_recordings` through `app.recordings_mv` into `app.recordings`, with stamped tenant and retention. Prior art: the chdb smoke tests and the exporter integration tests.
3. **Trace and error detail routes.** The app routes with the ClickHouse client mocked at `execute`. Assert: the player shows above the trace view when the Trace has a Session; the "no Recording" state; no player without a Session; Span click seeks; the Segment query is scoped to service, Session, and window and does not filter on `tenant_id`; the Stream comes from `everr.recording.stream.id` on the entry or, for a backend entry, on the Trace's browser Client spans, with the browser `ServiceName`; a stream id with no `recording` span shows the "no Recording" state. Prior art: the existing trace detail and error detail route tests and the trace repository tests.

Also, on existing tests rather than new seams:

- The SQL API tenant table list and the MCP query tool description test confirm `app.recordings` is not exposed.
- The browser OTLP CORS allow-lists include `Content-Encoding`: `collector/config.example.yml`, `collector/config.yml`, and the local gateway config.
- size-limit budgets for the `recording()` stub and the recorder chunk, checked with `pnpm size`.
- Per the project rules, ingestion is verified end to end with Everr: record a Session with the WebSDK `dev` option set, then query the `recording` span and the recordings table with the local Collector.

## Out of Scope

- PR verification evidence from Recordings. Its own effort later; the format (rrweb events intact, Segments in time order) does not block it.
- Generating e2e tests from Recordings. Its own effort later; same format note.
- Agent page read: accessibility snapshot, diff, or screenshot at one moment of a Stream, where its renderer runs, and how accessible names with personal data are Masked. The format does not block it.
- Video or screenshot capture. DOM recording only.
- A Session list or summary table. Listing Sessions with a Recording is a `traces` query on the `recording` span.
- Alerts that list the Sessions they hit.
- Deleting Recordings on request, per Visitor or Session.
- Propagating `session.id` to backend services.
- Custom handling for cross-origin iframes, canvas, and shadow DOM beyond what rrweb does.

## Further Notes

- Glossary terms used here (Recording, Stream, Segment, Replay, Mask, Block, Ignore, Session) are defined in `CONTEXT.md`. Prefer them; avoid "session replay" for the data.
- Known limits to document: a full page load or reload document request is its own Trace and has no Session; a cross-origin request that does not send `traceparent` is its own Trace; cron, webhooks, and other Traces with no browser Client span have no Session and no Replay.
- Volume reference from prior art: 13 KB/min gzip for a small SPA, up to 650 KB/min for a heavy SPA with navigations; a full snapshot is about 100 to 120 KB. The 5 minute snapshot adds about 20 KB/min.
- Raw rrweb costs an Agent about 270k tokens per minute, which is why the Agent surface is the text timeline.
- Prior art and research: `research/recorder-prior-art` and `research/agent-consumable-replay` branches. Replay layout prototype: `prototype/replay-player` branch, route `/replay-prototype` (variant A, Stage, is the chosen one).
