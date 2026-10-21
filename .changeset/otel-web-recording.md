---
"@everr/otel-web": minor
---

Add `@everr/otel-web/recording` with `recording()` and `emitRecording()`.

A sampled Session loads the recorder and keeps the last 5 minutes, with a full snapshot every 10 seconds. Nothing is sent until `emitRecording()`. `emitRecording({ last })` sends that much of the buffer, and `emitRecording()` sends the whole buffer. The Clip starts at the last full snapshot at or before the requested start.

Each Clip is a root `recording` span plus one or more `everr.browser.recording.segment` logs. A Segment is its own request. While a Stream is buffering, `everr.recording.stream.id` is on the envelope, and it is cleared when the Stream ends.
