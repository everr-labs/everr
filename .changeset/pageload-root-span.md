---
"@everr/otel-web": minor
---

`tracer.startActiveSpan()` now makes its span active until `end()`, not only for the synchronous call, because the SDK has no context manager; `startSpan()` parents to the active span. A custom instrumentation that calls `ctx.tracer.startSpan()` during the first load therefore gets a parent.

`pageLoad()` emits one `pageLoad` root span per first load, from the document time origin to LCP (the `load` event end in a browser without LCP), and keeps it active. Every SDK span that starts in that interval is its child, including the `network()` request spans (whose `traceparent` then carries the root's trace id, so the server spans join the same trace) and `slow_interaction`. After the root ends, spans are their own traces as before. The root also ends when the page becomes hidden, so a short visit still ships a complete trace, and its `everr.browser.page_load.end` attribute says what ended it: `lcp`, `load`, `hidden`, or `ceiling`.

The asset spans are named `pageLoad.asset.<initiator_type>` (for example `pageLoad.asset.script`) instead of `GET asset:<initiator_type> <url>`, so the name is stable across deployments; the resource URL stays in `url.full`. `long_animation_frame` is renamed `pageLoad.long_animation_frame`. The recording window (load + `settleMs`, or `ceilingMs`) is unchanged.

`InstrumentationContext` gains `onHide(listener)`: the SDK calls the listener at `pagehide` and at the hidden state, before its exit flush.
