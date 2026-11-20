---
"@everr/otel-web": minor
---

Add session recording on the `@everr/otel-web/recording` subpath. `recording()` keeps the page in memory with rrweb, aiming for the last 5 minutes and 10 MB, loaded as a separate chunk for sampled Sessions only. Nothing is sent until a Clip is emitted, automatically on an error, a 5xx response, or a request that gets no response, or with `recorder.emitClip()` and `recorder.startClip()`. Text, inputs, media, and sensitive attributes are masked by default. Recordings leave as `everr.browser.recording.segment` logs and add nothing to traces: each Segment says how far the Stream is sent and where the earliest open Clip starts, and the first Segment of a Clip carries its id and trigger. `clearIdentity()` ends the recording Stream and starts a new one, so no recording joins the ids from before the call to the ids after it.
