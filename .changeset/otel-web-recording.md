---
"@everr/otel-web": minor
---

Add `@everr/otel-web/recording` with `recording()` and `recorder`.

A sampled Session loads the recorder and keeps the last 5 minutes, with a full snapshot every 30 seconds. Nothing is sent until an error, a failed request, or a manual `recorder.emitClip()` or `recorder.startClip()`. The Clip starts at the last full snapshot at or before the requested start.

Each Clip is a root `recording` span plus one or more `everr.browser.recording.segment` logs. A Segment is its own request. While a Stream is buffering, `everr.recording.stream.id` is on the envelope, and it is cleared when the Stream ends.
