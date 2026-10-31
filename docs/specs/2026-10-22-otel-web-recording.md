# WebSDK Recording

**Date:** 2026-10-22
**Status:** implemented in draft PR #555, not released
**PR:** [#555](https://github.com/everr-labs/everr/pull/555)
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

The recorder is a lazy-loaded chunk. Sampling goes through the existing `sampled()` wrapper, so only a sampled Session downloads rrweb. Privacy runs in the browser before events enter the buffer. Segments use the existing OTLP transport.

This document covers only `packages/otel-web`. The collector and storage half is in [Recording Ingestion](./2026-10-23-recording-ingestion.md).

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

### `recording()`

```ts
type RecordingOptions = {
  maskAllText?: boolean;
  maskAllInputs?: boolean;
  blockAllMedia?: boolean;
  mask?: string[];
  unmask?: string[];
  block?: string[];
  ignore?: string[];
  maskFn?: (text: string) => string;
  maskAttributes?: string[];
};
```

- `recording()` has no sampling option. Wrap it in `sampled()` to record a share of Sessions: `sampled(recording(), 0.2)`. See Sampling and chunk loading.
- The privacy options are described in Privacy.
- A page with no Session id at setup starts no Stream.
- One recorder runs per page. A second `recording()` installed while the first is active does nothing, including one installed by a second `WebSDK` instance.
- Shutdown of the first recorder releases the page, so a later `WebSDK` (for example one constructed after a consent upgrade) can record.
- `recording()` is the only export that is an Instrumentation. The `recorder` methods act on the current page.

### `recorder.emitClip()`

`emitClip()` is the shortcut for the common case: send the buffered history now, without keeping a handle.

```ts
type EmitClipOptions = {
  last?: number;
};
```

- `emitClip({ last })` sends the same Clip as `startClip({ last }).end()`: the history from `last` milliseconds back.
- Without `last`, `emitClip()` sends the whole buffer. This is where it differs from `startClip().end()`, which has no buffered history.
- The buffered part is sent and the `recording` Span closes at the call. There is no tail.
- It returns `void` and is a no-op when capture is off. Use `startClip()` when you need a tail, `isRecording()`, or the Clip id.

### `recorder.startClip()`

`startClip()` is the recording analogue of `tracer.startSpan()`. It starts a Clip from the current Stream and returns a handle. With `last`, the buffered part is sent at once. The handle controls the tail and reports whether the Clip is real.

```ts
type StartClipOptions = {
  last?: number;
  next?: number; // capped at 60 000
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

- `last` starts the Clip that many milliseconds before the call. The buffered history from that point is sent at once (see Clip start and truncation).
- Without `last`, the Clip has no buffered history. It records only the range from the call to `end()`: the recorder takes a full snapshot at the call, and the Clip starts with it.
- `startTime` is the epoch-millisecond start that was requested: the call time minus `last`, or the call time without `last`. An inert Clip reports the same value.
- `next` closes the tail automatically after that many milliseconds. The tail leaves every 5 seconds, and the `recording` Span closes when the tail ends. `end()` closes the tail earlier, and `next: 0` closes it at once.
- Without `next`, the tail stays open until `end()`. A tail is open for at most 60 seconds after the Clip opens, so a handle that is never ended closes at the cap.
- `end()` is the analogue of `span.end()`. Calling it twice is safe. If the page hides first, the hide listener closes the Clip and its `recording` Span goes in the exit flush.
- `isRecording()` is the analogue of `span.isRecording()`. It is false for an inert Clip.
- `startClip()` always returns a handle, even when capture cannot start: before the recorder chunk loads, in an unsampled Session, when the page had no Session id at setup, or when `last` asks for history and the buffer has no full snapshot. The handle is inert: its `id` is empty, `isRecording()` is false, and `end()` does nothing. Callers do not need to branch before `end()`.
- With `last`, the buffered part of a real Clip is sent before `startClip()` returns. A Clip that is inert sends nothing.

### `recorder.pause()` and `recorder.resume()`

`recorder.pause()` stops the rrweb recorder. Nothing is buffered while paused, so no Clip can contain that time. `recorder.resume()` starts the recorder again with a full snapshot. Both act on the current page only.

Pause and resume travel inside the Segment body as rrweb custom events with tags `everr.recording.pause` and `everr.recording.resume`, so the player can draw the paused range instead of guessing from event silence. Repeated calls are no-ops.

### Internal seams

The recorder reaches the pipeline through two internal functions: `emitLogNow`, which sends one Log on its own request, and `setRecordingTrigger`, which fills the slot for automatic Clips. They are not public exports of any entry, including the server entry. The recording entry imports them by path, and the build puts them in a chunk shared with the main entry. A type test fails if a public entry exports them. The main entry gets no Session-change listener or other new export. The `recording` subpath itself is browser capture; the server entry does not export it.

## Behavior

### Sampling and chunk loading

Sampling goes through the existing `sampled()` wrapper, unchanged: `sampled(recording(), 0.2)` records about 20 percent of Sessions.

- `sampled()` hashes the Session id with the Instrumentation name, so every tab and reload of a Session decides the same way.
- The decision is made once per page, at setup. A Session change during the page does not decide again.
- An unsampled Session never runs the `recording()` setup. It loads no recorder and starts no Stream. `recorder.emitClip()` sends nothing, `recorder.startClip()` returns an inert Clip, and `recorder.pause()` and `recorder.resume()` do nothing.
- The recorder chunk (`dist/recording/recorder.js`) is loaded with `import()` when the setup runs, so only for a sampled Session. The stub stays at 1.05 KB and the chunk at 26 KB in the size budgets.
- A trigger that arrives while no Stream is buffering (before the chunk loads) is dropped. A new Stream has no history to send yet.

### Streams and the buffer

A Stream is the in-memory buffer of one document in one Session.

- One Stream per document. Two tabs of one Session give two Streams at once.
- Each Stream gets a random `everr.recording.stream.id`. While the Stream buffers, the instrumentation sets it through the same ambient set as `setAttributes()`, so later Logs and Spans carry it on the envelope. It is cleared when the Stream ends.
- The buffer holds the last 5 minutes, capped at 10 MB of raw rrweb JSON. Past the cap, the oldest events go first. The newest event is always kept, with the Meta event in front of it when it is a full snapshot, so a snapshot over the cap still plays. An event over the cap stays alone in the buffer only until the next event arrives.
- A full snapshot (rrweb checkout) is taken every 30 seconds. Snapshots, and the Meta event rrweb emits in front of each, age out of the buffer like every other event. There is no thinning.
- The page keeps one Stream with the Session id from setup. When the Session id changes during the page, the Stream, its buffer, and its Session id stay.
- A hard navigation or reload starts a new document, so it starts a new Stream. SPA navigation keeps the Stream and rotates only the page view.
- Segments and the `recording` Span take `session.id` from the Stream and do not read the Session. The recorder never moves the activity time. Only the app's own records keep the Session alive. Without this, a busy recorder could extend a Session indefinitely.

### Order of the emit path

Every rrweb event passes these steps in the emit callback, in this order, before it enters the buffer:

1. Privacy: attribute masking and file input removal (see Privacy).
2. Mutation throttle.

An event dropped by step 2 never enters the buffer, so it cannot push older events out of the 5-minute window or the 10 MB cap.

### Mutation throttle

A page that animates through the DOM can emit thousands of attribute mutations per second. Without a limit, a storm fills the 10 MB buffer in seconds and evicts the snapshot and the moments before an error, which are what the Clip exists to keep. The throttle runs on rrweb mutation events (incremental snapshot, source Mutation) only, and it limits attribute mutations only, the same scope as HyperDX.

- **Attribute mutations, per node.** Each node has a token bucket of 100 tokens that refills at 10 tokens per second. Each attribute mutation on a node takes one token. With no token left, the mutation is removed from the event. An element inside an `<svg>` takes tokens from its nearest `<svg>` ancestor, because an animated SVG changes many children at once.
- **Adds, removes, and texts are never throttled.** rrweb lists every added descendant and text node as its own add, so an ordinary route change can add thousands of nodes in one flush. Any count cap low enough to stop a storm would also drop normal navigation, often the moment before an error. Removing part of a batch of adds would also leave the player with children whose parents never arrived. A structural storm is bounded by the 10 MB buffer cap instead.
- **Empty events.** An event that the throttle emptied is dropped.
- **No marker, no extra snapshot.** The throttle writes nothing to the buffer and schedules nothing. The next regular full snapshot shows the state the dropped mutations led to.

Prior art: PostHog's `MutationRateLimiter`, as used by HyperDX ([limiter](https://github.com/hyperdxio/hyperdx-js/blob/77350427759e0e083d18982efe24fed07fe9b7fd/packages/session-recorder/src/sessionrecording-utils.ts#L122-L228), [wiring](https://github.com/hyperdxio/hyperdx-js/blob/77350427759e0e083d18982efe24fed07fe9b7fd/packages/session-recorder/src/index.ts#L128-L157)). The bucket, the SVG rule, the attribute-only scope, and the dropping of emptied events are the same. HyperDX also takes a full snapshot 1 second after the first blocked node; Everr relies on the regular checkout instead.

### Large events

- Each event is measured as UTF-8 bytes of its serialized JSON, not string length. The serialization is the one the buffer already stores.
- No event is too large to record. The recorder keeps running past an event of any size, and the event enters the buffer like any other.
- An event that does not fit in one Segment (about 950 KB) goes in Pieces. A Piece is a Segment that carries a slice, cut between characters, of one rrweb event too large for a Segment. The cut never falls inside a multi-byte character or a surrogate pair, and each Piece holds at most 950 000 bytes of UTF-8. Its body is the slice of the event's JSON text, not an array.
- The Pieces of an event are consecutive Segments of the Clip. Each carries `everr.recording.event.index` (the `everr.recording.segment.index` of the event's first Piece), `everr.recording.event.piece` (from 0), and `everr.recording.event.pieces` (the count of Pieces). The reader joins them in `everr.recording.event.piece` order before parsing the event, and puts the event in that place in the Clip.
- A Piece's timestamp is the timestamp of its event.
- Every request stays under the public receiver's 20 MiB body limit. Serialized JSON has no raw control characters, so the OTLP string escape at most doubles a Piece (a quote or a backslash).
- Why Pieces instead of a cap: in practice an event that large is a full snapshot. rrweb gives the nodes new ids on every full snapshot, so no later event can play without it. Dropping it or stopping the recorder would lose the rest of the page.
- HyperDX also splits large events ([split](https://github.com/hyperdxio/hyperdx-js/blob/77350427759e0e083d18982efe24fed07fe9b7fd/packages/session-recorder/src/index.ts#L201-L218), [assembler](https://github.com/hyperdxio/hyperdx/blob/cf00ae53f75ac35f6082a6279bbbf1d84bafed87/packages/app/src/utils/rrwebChunkAssembler.ts#L108-L151)). It cuts at byte offsets, which breaks multi-byte characters at the cut; Everr cuts between characters, so each Piece encodes on its own.

### Clip start and truncation

rrweb can only play from a full snapshot.

- A Clip with `last` starts at the last full snapshot at or before the requested start, plus the Meta event in front of it. The requested start is still carried by the `recording` Span.
- `emitClip()` without `last` starts at the earliest snapshot still in the buffer.
- `startClip()` without `last` starts at the full snapshot taken at the call, and is never truncated.
- When the requested start is before the oldest buffered moment (the 5-minute window, the 10 MB cap, or the Stream start), the Clip starts at the earliest snapshot still in the buffer and sets `everr.recording.clip.truncated = true`.
- A Clip that needs buffered history from a buffer with no full snapshot produces no Clip.

### Segments

- A Segment holds up to about 950 KB of JSON. An event that is larger goes in Pieces (see Large events).
- `everr.recording.segment.index` counts from 0 per Clip. A gap in the index means a request was lost or dropped at exit.
- Each Segment is one OTLP Log named `everr.browser.recording.segment`. Its body is the JSON array of rrweb events, or for a Piece a slice of one event's JSON text.
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
- Its `session.id` comes from the Stream, not from a Session read.

### Automatic Clips

Automatic triggers reach the recording entry through an internal listener slot. `InstrumentationContext` gets no new public member.

- Any error on the shared capture path triggers a Clip after the `errors()` `ignore` and `denyUrls` filters and the error rate limit. A filtered error does not open a Clip.
- With `network()` installed, a request with a 5xx response or no response triggers a Clip. That covers a rejected fetch, and an XHR that errors or times out. A 4xx is not a trigger. An explicit abort is not a trigger.
- `recording()` does not patch `fetch` itself. `network()` is the only network seam.
- An automatic Clip holds the last 60 seconds and stays open for the 10 seconds after its trigger.
- A trigger that arrives while an automatic Clip is open is ignored. It does not extend the tail and does not open a second Clip.
- A page has at most 5 automatic Clips. The count is held in memory by the recorder. A reload or another tab starts at zero.
- Manual Clips are independent of automatic ones: an open automatic Clip does not block them, and they do not count toward the cap.
- The sixth automatic Clip on a page sends nothing at all.

### Privacy

Privacy runs in the browser, before events enter the buffer. There is no server-side scrub, and Cookieless and Consented modes use the same rules.

The default bundle is on for every Session, in development and production:

| Data                                                                            | Default        |
| ------------------------------------------------------------------------------- | -------------- |
| All text                                                                        | Masked         |
| All input values                                                                | Masked         |
| `title`, `placeholder`, `aria-label`, `content`, `data-*` attributes            | Masked         |
| Hidden, checkbox, radio, button, and option values                              | Masked         |
| URL query and fragment                                                          | Removed        |
| `img`, `svg`, `video`, `object`, `picture`, `embed`, `map`, `audio`, icon links | Blocked        |
| `base`, same-origin `srcdoc` iframes                                            | Blocked        |
| File inputs                                                                     | Ignored        |
| Password inputs                                                                 | Masked, always |

- Explicit options win over the defaults, except that passwords stay Masked, file inputs stay Ignored, and URLs keep no query or fragment.
- `maskAttributes` replaces the default list. Passing an empty list disables attribute masking.
- Markers are always in the selector lists: `everr-mask`, `everr-block`, `everr-ignore`, and the matching `data-everr-*` attributes.
- `unmask` wins over Mask. There is no `unblock`: to record media, set `blockAllMedia: false` and list what to Block in `block`.
- A Mask replaces text with asterisks of the same length and keeps the element. `maskFn` replaces the asterisk substitution. A Block replaces an element with an empty placeholder of the same size. Ignore leaves input events inside an element out of the Recording and keeps the element.
- rrweb 2.1.7 has no attribute hook and leaves some values in the clear, so the emit callback scrubs a copy of each event before it enters the buffer. It applies `maskAttributes` to full-snapshot nodes, added nodes, and attribute mutations. It masks the values that rrweb copies as is: hidden, checkbox, radio, button, and option values, and the HTML `value` of a text input the user cleared. It deletes file input values.
- URL attributes (`href`, `src`, `srcset`, `action`, `formaction`, `poster`, `cite`, `background`, `ping`) and the page URL in the Meta event lose their query and fragment. A `mailto:`, `tel:`, or `sms:` URL keeps only its scheme.
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

- `everr.session` is unchanged. The recorder stores nothing in it.
- The recorder has no Session-change listener. A rotation, adopting another tab's Session, or `clearIdentity()` during the page keeps the Stream, its buffer, and its Session id.

## Emitted Telemetry

| Name                              | Kind       | Value                                                            |
| --------------------------------- | ---------- | ---------------------------------------------------------------- |
| `everr.browser.recording.segment` | event name | one per Segment; the collector routing key                       |
| `everr.recording.stream.id`       | attr       | random id per document; on the envelope while the Stream buffers |
| `everr.recording.clip.id`         | attr       | random id per Clip; on Segments and the `recording` Span         |
| `everr.recording.clip.truncated`  | attr       | `true` when the Clip starts later than requested                 |
| `everr.recording.segment.index`   | log attr   | int from 0 per Clip; a gap is a lost or dropped request          |
| `everr.recording.event.index`     | log attr   | on a Piece: the `segment.index` of its event's first Piece       |
| `everr.recording.event.piece`     | log attr   | on a Piece: int from 0, its place in the event                   |
| `everr.recording.event.pieces`    | log attr   | on a Piece: the count of Pieces of the event                     |
| `everr.recording.trigger`         | span attr  | `error`, `network`, or `manual`                                  |
| `recording`                       | span name  | one root Span per Clip, covering its range                       |

The tags `everr.recording.pause` and `everr.recording.resume` are rrweb custom events inside the Segment body, not OTLP attributes.

The envelope (`session.id`, `everr.page_view.id`, URL, route, `user.*`, and `everr.recording.stream.id` while a Stream buffers) is written as on every other record. There is no marker attribute `everr.recording`; the collector routes on the event name.

`session.id` is the OpenTelemetry semantic convention attribute. The recording names have no semantic convention, so they stay under the `everr.` prefix.

The browser events catalog in `skills/everr-use-telemetry/rules/browser-events.md` lists the Segment event name, the `recording` Span, and the attributes above.

## Packaging and Build

- `@everr/otel-web/recording` maps to `src/recording.ts` and builds to `dist/recording.js` plus `dist/recording/recorder.js`.
- The `pack` config in `vite.config.ts` gets two entries, `recording` and `recording/recorder`, so rrweb stays out of the stub.
- `@everr/otel-web` is external for the stub and React entry, so the consumer's export conditions choose the runtime.
- `@rrweb/record` is pinned to `2.1.7` and bundled into the recorder chunk. Integrators do not install rrweb. The player must use the same rrweb version.
- size-limit budgets are 1.05 KB for the stub and 26 KB for the recorder chunk. The main entry budgets are unchanged.
- The changeset is a minor release for `@everr/otel-web`, with one entry for recording.

## Design Decisions

- **Subpath and dynamic import.** Apps that do not record pay only the main entry. `sampled()` decides before the stub imports the chunk, so rrweb loads only for a sampled Session.
- **API symmetry with `tracer`.** Integrators already learn `tracer.startSpan()` and `span.end()`. `recorder.startClip()` with `clip.end()` reuses the Span shape: without `last` it records from the call, like a Span that starts at the call. `recorder.emitClip()` is the shortcut that needs no handle and sends history, the whole buffer by default. An inert handle when capture is off matches a non-recording Span, so caller code does not branch on sampling. `recording()` stays only the installation hook.
- **One recorder per page.** Two recorders would duplicate rrweb observers and produce two Streams for one document. The first `recording()` wins, and shutdown releases the page for a later `WebSDK`.
- **Sampling with `sampled()`.** Recording uses the same wrapper as every other Instrumentation, so there is one sampling rule and no rate on `recording()`. `sampled()` hashes the Session id, so reloads and tabs of a Session decide the same way. The decision is made once per page at setup, and the page keeps one Stream with the Session id from setup. A Session change during the page is rare, and deciding again would need a Session-change hook on the main entry. Recording without `sampled()` is accepted and documented: every Session loads the chunk and runs the observers.
- **Clips, not a continuous upload.** Nothing leaves the page until an error, a failed request, or a manual `emitClip()` or `startClip()`. This keeps volume and privacy exposure down. The 5-minute buffer is the trade: a Clip can only cover what is still in memory.
- **A full snapshot every 30 seconds, no thinning.** rrweb can only play from a full snapshot. A 30-second checkout keeps snapshots a small share of the buffer without a thinning pass. A Clip may start up to 30 seconds before the requested time, and the `recording` Span still carries the requested start.
- **Segments as OTLP Logs, one request each.** The collector already routes Logs by event name. A separate request per Segment keeps a 950 KB body out of the shared Log queue and lets the collector batch recording rows separately. The cost is more requests; the benefit is that a bad Clip cannot fail an ordinary Log insert.
- **One root Span per Clip.** The app and Agents need a small, queryable index entry for each Clip without reading rrweb. The Span gives the Clip range, trigger, ids, and truncation. It counts as one Span against usage.
- **No span ids inside a Clip.** rrweb events are opaque. A Clip joins other signals by `session.id`, `everr.recording.stream.id`, and time. Carrying span ids would require custom events and a larger format.
- **Session id saved on the Stream.** A Clip can be large and can arrive long after the last user action. Counting it as activity would keep the Session alive and merge unrelated page loads. The Stream saves the id at setup and the recorder never reads the Session. No new Session API is needed.
- **Automatic cap per page, no merging.** The cap and the merge only control volume. A count in memory and ignoring triggers while an automatic Clip is open need no shared Session state and no tail extension rules. The cost is that a reload or a second tab gets a fresh cap of 5.
- **No Segment exit path.** A Clip that is open at page hide closes and sends its `recording` Span through the normal Span exit path. Unsent tail Segments are dropped, and the index gap shows the loss. A special Segment exit path adds cross-cutting budget, queue, and ordering code for a best-effort tail, which is not worth it.
- **Throttle before the buffer.** The buffer is the scarce resource: 5 minutes and 10 MB. A mutation storm that reaches it evicts the history a Clip needs. Dropping attribute mutations loses detail inside the storm, and the next regular full snapshot repairs the page.
- **Large events in Pieces, no stop.** An event too large for a Segment is in practice a full snapshot, and no later event plays without it, so the recorder neither drops it nor stops. Cutting between characters keeps each Piece valid UTF-8 and each request under the receiver limit. The cost is a join step in the reader.
- **Browser-side privacy.** Masking before the buffer means unmasked data never leaves the page, even if the collector is misconfigured. There is no server scrub to maintain. rrweb options cover text, inputs, Block, and Ignore; the emit callback covers attributes because rrweb 2.1.7 has no hook.

## Testing

The tests drive the public boundaries and assert on what crosses them. They do not reach into rrweb internals, buffer variables, or private functions.

- `recording.test.ts` covers: nothing sent before `recorder.emitClip()` or `recorder.startClip()`; the chunk not loaded; unsampled Sessions; sampling with `sampled()` by the Session id hash, across reloads and tabs; one recorder per page and recording again after shutdown; the 5-minute buffer; Clip start at a full snapshot; `last` and `next`; `startClip()` without `last` starting at a full snapshot taken at the call; `emitClip()` sending the whole buffer without `last`, and the same Clip as `startClip({ last }).end()` with it; `clip.end()` and idempotence; inert handles before the chunk loads, in unsampled Sessions, and with no snapshot; truncation; 950 KB Segments and index order; the mutation throttle: the per-node bucket and refill, SVG descendants charged to the nearest `<svg>`, adds, removes, and texts passing through untouched, and dropping emptied events; large events: UTF-8 byte measurement, Pieces of at most 950 000 bytes with their event index, piece, and count, cuts between code points so multi-byte characters and quotes join back unchanged, recording that continues past an event over 10 MB, a first snapshot over 10 MB sent in Pieces and playable, and every request under 20 MiB however escaped; Stream id on the envelope; one root `recording` Span per Clip; the buffer surviving a Clip; the 10 MB cap; the 30-second checkout; one Stream for the page across a Session change and `clearIdentity()`; `session.id` taken from the Stream without a Session read; pause and resume; automatic Clips from errors, filtered errors, 5xx, no response, 4xx, and aborts; triggers ignored while an automatic Clip is open; triggers dropped while no Stream is buffering; the 5-Clip cap per page; manual Clips not blocked and not counted; no fetch patch; page hide closing the Clip and dropping the unsent tail.
- `recording.privacy.test.ts` covers the default bundle in development and production (the `dev` option does not change it), the values rrweb leaves in the clear, URL query and fragment removal, markers, selector options, `unmask` precedence, passwords, file inputs, attribute masking, `maskFn`, and the media list.
- `emitter.test.ts` covers the immediate Segment path, the Stream's `session.id` on Segment envelopes, the existing exit budget for Spans and Logs, and host send.
- `transport.test.ts` covers endpoint resolution, keepalive on the exit path, and the host receiving a string.
- `type-guarantees.test.ts` fails if a public entry exports `emitLogNow` or `setRecordingTrigger`, or if `recording()` accepts `sampleRate`.
- size-limit checks the stub and recorder chunk, and the unchanged main entry budgets.
- `pnpm --filter @everr/otel-web test`, `typecheck`, and `size` are the gates.
- Ingestion must be verified end to end with Everr against a fresh stack: Segments land in the recordings table under the key's org, ordinary Logs stay in `logs`, privacy holds in storage and in the player, and a failed fetch produces a network Clip. This follows the project rule to check ingestion with Everr.

## Rollout

1. Release `@everr/otel-web` as a minor version.
2. Verify a real page: `recording()`, `errors()`, `network()`, a forced error, and a failed request. Confirm Segments arrive, ordinary Logs still arrive, and the player can open the Clip.
3. Keep the player's rrweb version at `2.1.7` while the recorder is pinned there.

## Known Limits

- `recording()` without `sampled()` loads the recorder chunk and runs rrweb observers in every Session, even when no Clip is sent.
- A Session change during the page keeps the old Stream. Later Clips carry the Session id from setup, and sampling is not decided again, also after `clearIdentity()`.
- `recorder.startClip()` returns an inert Clip, and `recorder.pause()` and `recorder.resume()` do nothing, before the chunk loads or in an unsampled Session.
- A manual Clip that is never ended closes 60 seconds after it opens.
- A Clip whose requested start is before the oldest snapshot starts later than asked and is marked truncated.
- A Clip can start up to 30 seconds before the requested time, because it starts at a full snapshot.
- A CSS `background-image` is not Blocked.
- There is no `unblock`. Recording some media means turning off `blockAllMedia` and listing the rest in `block`.
- The throttle bounds what enters the buffer, not rrweb's own observer cost. A page with very many DOM changes still costs CPU to observe.
- After the throttle drops attribute mutations, the player shows a stale page until the next full snapshot, up to 30 seconds. Nothing marks the range.
- Adds, removes, and texts are not throttled. A page that rebuilds a large subtree in a loop can fill the 10 MB buffer and evict older history. Only the buffer cap bounds it.
- An event over 10 MB is alone in the buffer until the next event pushes it out. On a page whose full snapshot is that large, Clips from the buffer (with `last`, from `emitClip()`, and automatic Clips) usually find no snapshot and send nothing. Only `startClip()` without `last` holds the snapshot.
- A full page load or reload document request is its own Trace and has no Session.
- A cross-origin request that does not send `traceparent` is its own Trace.
- Cron, webhooks, and other Traces with no browser Client Span have no Session and no player.
- A page hide during a tail drops the unsent tail Segments. The index gap is the only signal.
- An event with a missing Piece cannot be joined and is lost.
- No retry on any Segment request.
- A page has at most 5 automatic Clips. A reload or another tab starts a new count, so one Session can send more than 5. Manual Clips are not capped.
- A second error inside an open automatic Clip is not labeled and does not extend the tail. It is in the Clip only if it falls inside the 10-second tail.
- A second `recording()` on the same page does nothing until the first WebSDK shuts down.
- A trigger that arrives while no Stream is buffering is dropped, for example before the chunk loads.
- Cross-origin iframes, canvas, and shadow DOM behave as rrweb records them, with no custom handling.

## Out of Scope

- Collector routing, the recordings table, and local chdb storage. Covered by [Recording Ingestion](./2026-10-23-recording-ingestion.md).
- The Replay player and the Trace and error views.
- An integrator guide. The package README documents recording.
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

- PR: https://github.com/everr-labs/everr/pull/555
- Collector and storage: `docs/specs/2026-10-23-recording-ingestion.md`
- Integrator docs: the Session recording section of `packages/otel-web/README.md`
- Glossary: `CONTEXT.md` (Recording, Mask, Block, Ignore, Stream, Clip, Segment, Piece, Replay)
- Browser events catalog: `skills/everr-use-telemetry/rules/browser-events.md`
- rrweb release: `rrweb@2.1.7`
