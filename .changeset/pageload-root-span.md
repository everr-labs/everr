---
"@everr/otel-web": minor
---

`pageLoad()` now emits one `PageLoad` root span per first load, starting at the document time origin and ending at LCP. The asset spans are its children and are named `pageLoad.asset.<initiator_type>` (for example `pageLoad.asset.script`) instead of `GET asset:<initiator_type> <url>`, so the span name is stable across deployments; the resource URL stays in `url.full`. The recording window (load + `settleMs`, or `ceilingMs`) is unchanged. The internal tracer accepts `childOf(parent)` as the context argument of `startSpan` to nest a span in an existing trace.
