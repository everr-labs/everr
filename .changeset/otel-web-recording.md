---
"@everr/otel-web": minor
---

Add session recording on the `@everr/otel-web/recording` subpath. `recording()` keeps the last 5 minutes of the page in memory with rrweb, loaded as a separate chunk for sampled Sessions only. Nothing is sent until a Clip is emitted, automatically on an error or a failed request, or with `recorder.emitClip()` and `recorder.startClip()`. Text, inputs, media, and sensitive attributes are masked by default.
