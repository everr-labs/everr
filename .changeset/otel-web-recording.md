---
"@everr/otel-web": minor
---

Add session recording on the `@everr/otel-web/recording` subpath. `recording()` keeps the page in memory with rrweb, aiming for the last 5 minutes and 10 MB, loaded as a separate chunk for sampled Sessions only. Nothing is sent until a Clip is emitted, automatically on an error, a 5xx response, or a request that gets no response, or with `recorder.emitClip()` and `recorder.startClip()`. Text, inputs, media, and sensitive attributes are masked by default.
