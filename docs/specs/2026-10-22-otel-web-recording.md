# WebSDK Recording

**Date:** 2026-10-22
**Status:** proposed API revision, not implemented
**PR:** [#527](https://github.com/everr-labs/everr/pull/527)
**Scope:** `packages/otel-web`

## Problem Statement

When something goes wrong in a web app, a developer can read the Trace, the Logs, and the error, but not the screen. The signals say what the system did. They do not say which button was pressed, what the page showed, whether a spinner never stopped, or whether the error was visible at all. The developer asks for a screenshot, tries to reproduce the flow by hand, and often cannot.

An Agent has the same gap. It can read Logs and Traces with the existing `query` tool, but it cannot tell what the person did between them.

Capturing the screen history has three constraints that shape this design:

1. Nothing should leave the page until something worth keeping happens.
2. The recorder must not change the bundle cost of apps that do not record, and it must not run in Sessions that were not sampled.
3. Personal data must be removed in the browser, before it enters memory, not in the collector.

## Solution

Add a recording Instrumentation on a new subpath, `@everr/otel-web/recording`. It keeps the last 5 minutes of the page's DOM history in memory with rrweb. No rrweb event leaves the page until a Clip is emitted: automatically on an error or a failed request, or by the integrator with `recorder.emitClip()` or `recorder.startClip()`.

The entry exports a `recorder` singleton, like the `tracer` object in the main entry. `emitClip()` is the fire-and-forget shortcut. `startClip()` returns a handle, the way `startSpan()` returns a Span: `end()` closes it.

```ts
import { recorder } from "@everr/otel-web/recording";

recorder.emitClip({ last: 15_000 }); // send the last 15 seconds and close

const flow = recorder.startClip({ last: 60_000 });
try {
  await submitOrder();
} finally {
  flow.end(); // close the tail, emit the recording Span
}
```

A Clip is sent as one or more OTLP Logs called Segments. Each Segment is its own request, so a large Clip cannot fail an ordinary Log batch. A Clip also gets one root `recording` Span, which is how the app and Agents find it. The collector routes Segments into the recordings table, and the app plays them on the Trace and error views.

The recorder is a lazy-loaded chunk. The stub decides sampling, and only a sampled Session downloads rrweb. Privacy runs in the browser before events enter the buffer. Segments use the existing OTLP transport.

The collector and app halves of the feature are in the same PR, but this document covers only `packages/otel-web`. The overall product design is in `docs/specs/2026-10-17-session-replay.md`; this document revises the WebSDK API, privacy gate, and transport in that design.

## Public API

`@everr/otel-web/recording` exports two things: `recording()`, which installs capture, and a `recorder` singleton, which is the imperative surface. `recorder` is like `tracer` in the main entry. `recording()` returns only the teardown that `WebSDK.shutdown()` calls.

```ts
recording(options?: RecordingOptions): Instrumentation;

const recorder: {
  emitClip(options?: EmitClipOptions): void;
  startClip(options?: StartClipOptions): RecordingClip;
  pause(): void;
  resume(): void;
};
```

The first draft of this feature used free functions, `emitRecording()`, `pauseRecording()`, and `resumeRecording()`. This spec supersedes those names. `emitRecording()` splits into the fire-and-forget `recorder.emitClip()` and the handle-based `recorder.startClip()`. The code, overall spec, guide, tickets, and telemetry skill follow in a later change.

### `recording()`

```ts
type RecordingOptions = {
  sampleRate?: number; // default 1
  maskAllText?: boolean;
  maskAllInputs?: boolean;
  blockAllMedia?: boolean;
  mask?: string[];
  unmask?: string[];
  block?: string[];
  unblock?: string[];
  ignore?: string[];
  maskFn?: (text: string) => string;
  maskAttributes?: string[];
};
```

- `sampleRate` is the share of Sessions that load the recorder. Values are clamped to the range 0 to 1.
- The privacy options are described in Privacy.
- One recorder runs per page. A second `recording()` installed while the first is active does nothing, including one installed by a second `WebSDK` instance.
- Shutdown of the first recorder releases the page, so a later `WebSDK` (for example one constructed after a consent upgrade) can record.
- `recording()` is the only export that is an Instrumentation. The `recorder` methods act on the current page.

### `recorder.emitClip()`

`emitClip()` is the shortcut for the common case: send a Clip now, with an optional tail, without keeping a handle. It is the fire-and-forget form of `startClip()`.

```ts
type EmitClipOptions = (
  | { last: number; since?: never }
  | { since: number; last?: never }
  | { last?: never; since?: never }
) & {
  next?: number; // default 0, capped at 60 000
};
```

- It takes the same start options as `startClip()`: `last`, `since`, or neither.
- `next` keeps the Clip open after the call, like `startClip()`, but the default is 0. With the default, the buffered part is sent and the `recording` Span closes at the call. With a tail, the caller gets no handle to end early.
- It returns `void` and is a no-op when capture is off. Use `startClip()` when you need `isRecording()` or an early `end()`.

### `recorder.startClip()`

`startClip()` is the recording analogue of `tracer.startSpan()`. It starts a Clip from the current Stream and returns a handle. The buffered part is sent at once. The handle controls the tail and reports whether the Clip is real.

```ts
type StartClipOptions = (
  | { last: number; since?: never }
  | { since: number; last?: never }
  | { last?: never; since?: never }
) & {
  next?: number; // optional, capped at 60 000
};

type RecordingClip = {
  /** Empty for an inert Clip. */
  readonly id: string;
  /** Epoch milliseconds of the requested start. */
  readonly startTime: number;
  /** False before the recorder chunk loads, in an unsampled Session, after the Stream ends, or after end(). */
  isRecording(): boolean;
  /** Closes the tail and emits the recording Span. Idempotent. */
  end(): void;
};
```

- `last` starts the Clip that many milliseconds before the call.
- `since` starts the Clip at an epoch-millisecond timestamp.
- `last` and `since` are mutually exclusive in the type.
- With neither, the Clip is the whole buffer.
- `startTime` is the epoch-millisecond start that was requested. For an inert Clip with no buffer, it is the time of the call.
- `next` closes the tail automatically after that many milliseconds. The buffered part is sent at once, the tail leaves every 5 seconds, and the `recording` Span closes when the tail ends. `end()` closes the tail earlier, and `next: 0` closes it at once.
- Without `next`, the tail stays open until `end()`. A tail is open for at most 60 seconds after the Clip opens, so a handle that is never ended closes at the cap.
- `end()` is the analogue of `span.end()`. Calling it twice is safe. If the page hides first, the hide listener closes the Clip and its `recording` Span goes in the exit flush.
- `isRecording()` is the analogue of `span.isRecording()`. It is false for an inert Clip.
- `startClip()` always returns a handle, even when capture cannot start: before the recorder chunk loads, in an unsampled Session, when the buffer has no full snapshot, or after the Session was cleared. The handle is inert: its `id` is empty, `isRecording()` is false, and `end()` does nothing. Callers do not need to branch before `end()`.
- The buffered part of a real Clip is sent before `startClip()` returns. A Clip that is inert sends nothing.

### `recorder.pause()` and `recorder.resume()`

`recorder.pause()` stops the rrweb recorder. Nothing is buffered while paused, so no Clip can contain that time. `recorder.resume()` starts the recorder again with a full snapshot. Both act on the current page only.

Pause and resume travel inside the Segment body as rrweb custom events with tags `everr.recording.pause` and `everr.recording.resume`, so the player can draw the paused range instead of guessing from event silence. Repeated calls are no-ops.

### Server entry

The new seams that the recording entry imports from the main package (`emitLogNow`, `setRecordingTrigger`, `claimAutomaticClip`, `onSessionChange`, `passiveSessionId`) have no-op implementations in `src/server.ts`. The `recording` subpath itself is browser capture; the server entry does not export it.

## Behavior

### Sampling and chunk loading

The stub makes the sampling decision before it imports the recorder:

```ts
keeps(sessionId) = sampleRate >= 1 || hashUnit(`${sessionId}:recording`) < sampleRate
```

- The same hash that `sampled()` uses decides, so every tab and reload of a Session decides the same way.
- `sampleRate: 0` loads no recorder and starts no Stream. `recorder.emitClip()` sends nothing, `recorder.startClip()` returns an inert Clip, and `recorder.pause()` and `recorder.resume()` do nothing.
- Wrapping `recording()` in `sampled()` multiplies the rates. With `sampled(recording(), 0.5)` and `recording({ sampleRate: 0.5 })`, about 25 percent of Sessions record. The docs warn against it.
- The recorder chunk (`dist/recording/recorder.js`) is loaded with `import()` only for a sampled Session. The stub stays at 1.05 KB and the chunk at 26 KB in the size budgets.
- A trigger that arrives while a new Session is ending the old Stream and loading the new chunk is held, then applied to the new Stream. Without that, an error that also rotates the Session would lose its Clip.

### Streams and the buffer

A Stream is the in-memory buffer of one document in one Session.

- One Stream per document per Session. Two tabs of one Session give two Streams at once.
- Each Stream gets a random `everr.recording.stream.id`. While the Stream buffers, the instrumentation sets it through the same ambient set as `setAttributes()`, so later Logs and Spans carry it on the envelope. It is cleared when the Stream ends.
- The buffer holds the last 5 minutes, capped at 10 MB of raw rrweb JSON. Past the cap, the oldest events go first. The newest event is always kept, even when it alone is over the cap.
- A full snapshot (rrweb checkout) is taken every 10 seconds. Every snapshot from the last 60 seconds is kept. Older snapshots are thinned to one per minute. The Meta event in front of a kept snapshot stays, because the player reads the viewport from it.
- When the Session id changes during a page, the current Stream ends, its buffer is dropped, and sampling is decided again. If the new Session is sampled, a new Stream starts with a full snapshot. A Clip never mixes two Sessions.
- A hard navigation or reload starts a new document, so it starts a new Stream. SPA navigation keeps the Stream and rotates only the page view.
- The buffer does not keep the Session alive. Segments and the `recording` Span read the Session id through a passive read that does not move the activity time. Only the app's own records keep it alive. Without this, a busy recorder could extend a Session indefinitely.

### Clip start and truncation

rrweb can only play from a full snapshot.

- A Clip starts at the last full snapshot at or before the requested start, plus the Meta event in front of it. The requested start is still carried by the `recording` Span.
- When the requested start is before the oldest buffered moment (the 5-minute window, the 10 MB cap, or the Stream start), the Clip starts at the earliest snapshot still in the buffer and sets `everr.recording.clip.truncated = true`.
- A buffer with no full snapshot at all produces no Clip.

### Segments

- A Segment holds up to about 950 KB of JSON. One event that is already larger goes alone in its own Segment.
- `everr.recording.segment.index` counts from 0 per Clip. A gap in the index means a request was lost or dropped at exit.
- Each Segment is one OTLP Log named `everr.browser.recording.segment`. Its body is the JSON array of rrweb events.
- A Segment is sent on its own request through the logs path. It does not enter the shared logs queue, and it does not attach the active Span, because a Clip carries no span ids.
- The Segment timestamp is the timestamp of its last event.
- The Segment still goes through the `beforeSend` hook as a Log. Returning `null` drops it like any other record.
- Each Clip is independent. Two overlapping Clips both carry the overlapping events, with different clip ids. The buffer is not cleared after a Clip.
- A tail closes its current Segment every 5 seconds, and once more when the tail ends.

### The `recording` Span

- One root Span per Clip, named `recording`.
- It starts at the requested start, even when the Clip's first event is an earlier snapshot, and ends when the Clip handle closes (through `end()`, `next`, the 60-second cap, or page hide).
- It carries `everr.recording.clip.id`, `everr.recording.stream.id`, `everr.recording.trigger`, and `everr.recording.clip.truncated` when the Clip starts late.
- It is created with `root: true`, so later Logs, clicks, and requests do not become its children.
- It is emitted when the Clip ends, through `clip.end()`, `next`, the 60-second cap, or the hide listener when the page hides during a tail. In the hide case, the Span goes in the exit flush.
- Its envelope comes from a passive Session read.

### Automatic Clips

Automatic triggers reach the recording entry through an internal listener slot. `InstrumentationContext` gets no new public member.

- Any error on the shared capture path triggers a Clip after the `errors()` `ignore` and `denyUrls` filters and the error rate limit. A filtered error does not open a Clip.
- With `network()` installed, a request with a 5xx response or no response triggers a Clip. That covers a rejected fetch, and an XHR that errors or times out. A 4xx is not a trigger. An explicit abort is not a trigger.
- `recording()` does not patch `fetch` itself. `network()` is the only network seam.
- An automatic Clip holds the last 60 seconds and stays open for the 10 seconds after its trigger.
- A trigger that arrives while an automatic tail is open extends the tail to 10 seconds after that trigger, capped at 60 seconds after the first trigger. The trigger label stays the first trigger's.
- A trigger after the cap opens a new automatic Clip.
- A Session has at most 5 automatic Clips. The count lives on the Session state, is written immediately, and is shared by every tab and reload. A new Session starts at zero.
- Manual Clips never merge into an automatic tail and do not count toward the cap.
- The cap is claimed before the first Segment leaves, so the sixth automatic Clip sends nothing at all.

### Privacy

Privacy runs in the browser, before events enter the buffer. There is no server-side scrub, and Cookieless and Consented modes use the same rules.

The default bundle is on for every Session, in development and production:

| Data                                                                            | Default        |
| ------------------------------------------------------------------------------- | -------------- |
| All text                                                                        | Masked         |
| All input values                                                                | Masked         |
| `title`, `placeholder`, `aria-label`                                            | Masked         |
| `img`, `svg`, `video`, `object`, `picture`, `embed`, `map`, `audio`, icon links | Blocked        |
| `base`, same-origin `srcdoc` iframes                                            | Blocked        |
| File inputs                                                                     | Ignored        |
| Password inputs                                                                 | Masked, always |

- Explicit options win over the defaults, except that passwords stay Masked and file inputs stay Ignored.
- `maskAttributes` replaces the default list. Passing an empty list disables attribute masking.
- Markers are always in the selector lists: `everr-mask`, `everr-block`, `everr-ignore`, and the matching `data-everr-*` attributes.
- `unmask` wins over Mask and `unblock` wins over Block. `unblock` is expressed as `:not(...)` on each block selector because rrweb matches each element on its own. A Blocked parent still drops its children, so `unblock` cannot reveal an element inside it.
- A Mask replaces text with asterisks of the same length and keeps the element. `maskFn` replaces the asterisk substitution. A Block replaces an element with an empty placeholder of the same size. Ignore leaves input events inside an element out of the Recording and keeps the element.
- rrweb 2.1.7 has no attribute hook, so `maskAttributes` is applied in the emit callback to full-snapshot nodes, added nodes, and attribute mutations before the event enters the buffer. File input values are deleted there too.
- `maskAllInputs` is passed to rrweb as `true` internally so `maskInputFn` runs for every value. The function returns the original text when the value is not Masked, and it never returns a password in the clear.
- A CSS `background-image` is not Blocked. Cross-origin iframes, canvas, and shadow DOM are recorded as rrweb records them, with no custom handling.
- The WebSDK `dev` option does not change recording privacy. A development build records the same Masked text, inputs, and attributes, and the same Blocked media, as production. Explicit options are the only way to opt out of a default.

### Transport

- A Segment uses the existing OTLP logs transport. Requests stay plain JSON.
- Segments are not part of the exit flush.
- A host `send` gets the plain JSON string. The keepalive budget does not apply to a host.
- There is no retry. A failed request is dropped, and the gap shows in `everr.recording.segment.index`.

### Exit flush

The exit flush is unchanged for Spans and Logs. It keeps the 64 KB keepalive budget, with Spans taking up to a quarter and Logs taking the rest. Segments are not added to this path.

- On page hide, the recorder closes an open Clip at the hide time and ends its `recording` Span.
- The `recording` Span enters the normal Span queue. It shares the Span share of the exit budget and can be dropped like any other Span.
- Unsent tail Segments are dropped. The gap shows in `everr.recording.segment.index`.
- The Clip adds no special request, header, queue, or ordering rule to the exit path.

### Session accounting

- `everr.session` gains an optional `autoClips` count. It is absent until the first automatic Clip, and it is written immediately, not on the 30-second activity delay, so a reload sees it.
- A passive Session read returns the id the page already has and does not move the activity time. It also does not adopt another tab's Session. The next active read does that, which is what ends the old Stream.
- `clearIdentity()` clears the stored Session, so the next read rotates it, which ends the Stream and drops its buffer. A Clip cannot be sent from a Session the page has cleared.

## Emitted Telemetry

| Name                              | Kind       | Value                                                                        |
| --------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `everr.browser.recording.segment` | event name | one per Segment; the collector routing key                                   |
| `everr.recording.stream.id`       | attr       | random id per document per Session; on the envelope while the Stream buffers |
| `everr.recording.clip.id`         | attr       | random id per Clip; on Segments and the `recording` Span                     |
| `everr.recording.clip.truncated`  | attr       | `true` when the Clip starts later than requested                             |
| `everr.recording.segment.index`   | log attr   | int from 0 per Clip; a gap is a lost or dropped request                      |
| `everr.recording.trigger`         | span attr  | `error`, `network`, or `manual`                                              |
| `recording`                       | span name  | one root Span per Clip, covering its range                                   |

The envelope (`session.id`, `everr.page_view.id`, URL, route, `user.*`, and `everr.recording.stream.id` while a Stream buffers) is written as on every other record. There is no marker attribute `everr.recording`; the collector routes on the event name.

`session.id` is the OpenTelemetry semantic convention attribute. The recording names have no semantic convention, so they stay under the `everr.` prefix.

The browser events catalog in `skills/everr-use-telemetry/rules/browser-events.md` lists the Segment event name, the `recording` Span, and the attributes above.

## Packaging and Build

- `@everr/otel-web/recording` maps to `src/recording.ts` and builds to `dist/recording.js` plus `dist/recording/recorder.js`.
- `tsdown` gets two entries, `recording` and `recording/recorder`, so rrweb stays out of the stub.
- `@everr/otel-web` is `neverBundle` for the stub and React entry, so the consumer's export conditions choose the runtime.
- `@rrweb/record` is pinned to `2.1.7` and bundled into the recorder chunk. Integrators do not install rrweb. The player must use the same rrweb version.
- size-limit budgets are 1.05 KB for the stub and 26 KB for the recorder chunk. The main entry budgets include the passive Session read and the Session-change listener.
- The changeset is a minor release for `@everr/otel-web`, with one entry for recording.

## Design Decisions

- **Subpath and dynamic import.** Apps that do not record pay only the main entry. The stub keeps sampling; rrweb loads only for a sampled Session.
- **API symmetry with `tracer`.** Integrators already learn `tracer.startSpan()` and `span.end()`. `recorder.emitClip()` covers the fire-and-forget case, and `recorder.startClip()` with `clip.end()` reuses the Span shape. An inert handle when capture is off matches a non-recording Span, so caller code does not branch on sampling. `recording()` stays only the installation hook.
- **One recorder per page.** Two recorders would duplicate rrweb observers and produce two Streams for one document. The first `recording()` wins, and shutdown releases the page for a later `WebSDK`.
- **Per-Session sampling.** A decision per page would split a Recording across reloads and tabs. Hashing the Session id gives one decision for the whole Session. The cost of `sampleRate: 1` is accepted and documented: every Session loads the chunk and runs the observers.
- **Clips, not a continuous upload.** Nothing leaves the page until an error, a failed request, or a manual `emitClip()` or `startClip()`. This keeps volume and privacy exposure down. The 5-minute buffer is the trade: a Clip can only cover what is still in memory.
- **Full snapshots and thinning.** rrweb can only play from a full snapshot. Keeping every 10-second snapshot forever would make the buffer mostly snapshots, so older ones are thinned to one per minute. A Clip may start up to a minute before the requested time, which the truncation attribute and the player explain.
- **Segments as OTLP Logs, one request each.** The collector already routes Logs by event name. A separate request per Segment keeps a 950 KB body out of the shared Log queue and lets the collector batch recording rows separately. The cost is more requests; the benefit is that a bad Clip cannot fail an ordinary Log insert.
- **One root Span per Clip.** The app and Agents need a small, queryable index entry for each Clip without reading rrweb. The Span gives the Clip range, trigger, ids, and truncation. It counts as one Span against usage.
- **No span ids inside a Clip.** rrweb events are opaque. A Clip joins other signals by `session.id`, `everr.recording.stream.id`, and time. Carrying span ids would require custom events and a larger format.
- **Passive Session reads.** A Clip can be large and can arrive long after the last user action. Counting it as activity would keep the Session alive and merge unrelated page loads. Segments and the `recording` Span read the id without sliding the activity time.
- **Automatic cap on the Session.** The cap is 5 per Session, not per page, so reloads and tabs share it. The count is written immediately so a reload cannot reset it.
- **No Segment exit path.** A Clip that is open at page hide closes and sends its `recording` Span through the normal Span exit path. Unsent tail Segments are dropped, and the index gap shows the loss. A special Segment exit path adds cross-cutting budget, queue, and ordering code for a best-effort tail, which is not worth it.
- **Browser-side privacy.** Masking before the buffer means unmasked data never leaves the page, even if the collector is misconfigured. There is no server scrub to maintain. rrweb options cover text, inputs, Block, and Ignore; the emit callback covers attributes because rrweb 2.1.7 has no hook.

## Testing

The tests drive the public boundaries and assert on what crosses them. They do not reach into rrweb internals, buffer variables, or private functions.

- `recording.test.ts` covers: nothing sent before `recorder.emitClip()` or `recorder.startClip()`; the chunk not loaded; unsampled Sessions; sampling by `hashUnit` and across reloads and tabs; one recorder per page and recording again after shutdown; the 5-minute buffer; Clip start at a full snapshot; whole-buffer, `last`, `since` by timestamp, and `next`; `emitClip()` with the default `next` and with a tail; `clip.end()` and idempotence; inert handles before the chunk loads, in unsampled Sessions, with no snapshot, and after the Session was cleared; truncation; 950 KB Segments and index order; Stream id on the envelope; one root `recording` Span per Clip; the buffer surviving a Clip; the 10 MB cap; snapshot thinning; oversized events; Session rotation; cleared identity; passive Session reads; pause and resume; automatic Clips from errors, filtered errors, 5xx, no response, 4xx, and aborts; tail merge and the 60-second cap; the 5-Clip Session cap across reloads; manual Clips not merging or counting; no fetch patch; page hide closing the Clip and dropping the unsent tail.
- `recording.privacy.test.ts` covers the default bundle in development and production (the `dev` option does not change it), markers, selector options, `unmask` and `unblock` precedence, passwords, file inputs, attribute masking, `maskFn`, and the media list.
- `emitter.test.ts` covers the immediate Segment path, passive envelopes, the existing exit budget for Spans and Logs, and host send.
- `transport.test.ts` covers endpoint resolution, keepalive on the exit path, and the host receiving a string.
- size-limit checks the stub and recorder chunk, plus the raised main entry budgets.
- `pnpm --filter @everr/otel-web test`, `typecheck`, and `size` are the gates. The implemented baseline had 500 tests; this revision adds the Clip handle and `emitClip()` cases and updates the privacy and transport cases.
- Ingestion must be verified end to end with Everr against a fresh stack: Segments land in the recordings table under the key's org, ordinary Logs stay in `logs`, privacy holds in storage and in the player, and a failed fetch produces a network Clip. This follows the project rule to check ingestion with Everr.

## Rollout

1. Release `@everr/otel-web` as a minor version.
2. Verify a real page: `recording()`, `errors()`, `network()`, a forced error, and a failed request. Confirm Segments arrive, ordinary Logs still arrive, and the player can open the Clip.
3. Keep the player's rrweb version at `2.1.7` while the recorder is pinned there.

## Known Limits

- `sampleRate: 1` loads the recorder chunk and runs rrweb observers in every Session, even when no Clip is sent.
- `recorder.startClip()` returns an inert Clip, and `recorder.pause()` and `recorder.resume()` do nothing, before the chunk loads or in an unsampled Session.
- A manual Clip that is never ended closes 60 seconds after it opens.
- A Clip whose requested start is before the oldest snapshot starts later than asked and is marked truncated.
- A CSS `background-image` is not Blocked.
- A Blocked parent drops its children, so `unblock` cannot reveal an element inside it.
- rrweb has no mutation cap, so a page with very many DOM changes costs more CPU.
- A full page load or reload document request is its own Trace and has no Session.
- A cross-origin request that does not send `traceparent` is its own Trace.
- Cron, webhooks, and other Traces with no browser Client Span have no Session and no player.
- A page hide during a tail drops the unsent tail Segments. The index gap is the only signal.
- No retry on any Segment request.
- A Session has at most 5 automatic Clips. Manual Clips are not capped.
- A second `recording()` on the same page does nothing until the first WebSDK shuts down.
- A trigger that arrives before the first chunk has loaded, outside a Session change, is dropped.
- Cross-origin iframes, canvas, and shadow DOM behave as rrweb records them, with no custom handling.

## Out of Scope

- Collector routing, the recordings table, and local chdb storage. Covered by the same PR and the overall spec.
- The Replay player and the Trace and error views. Covered by the same PR and the overall spec.
- The integrator guide and the telemetry skill. Covered by the same PR.
- Recording a whole Session from start to end. Clips only.
- Video or screenshot capture. DOM recording only.
- Removing duplicate events between overlapping Clips.
- Propagating `session.id` to backend services.
- Server-side scrub.
- Deleting Recordings on request, per Visitor or Session.
- Alerts that list the Sessions they hit.
- PR verification evidence from Clips.
- Generating e2e tests from Clips.
- Agent page reads: accessibility snapshot, diff, or screenshot at one moment of a Clip.

## References

- PR: https://github.com/everr-labs/everr/pull/527
- Overall design: `docs/specs/2026-10-17-session-replay.md`
- Integrator guide: `packages/docs/content/docs/guides/session-replay.mdx`
- Glossary: `CONTEXT.md` (Recording, Mask, Block, Ignore, Stream, Clip, Segment, Replay)
- Browser events catalog: `skills/everr-use-telemetry/rules/browser-events.md`
- rrweb release: `rrweb@2.1.7`
