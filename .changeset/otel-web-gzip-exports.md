---
"@everr/otel-web": minor
---

Gzip browser OTLP exports with CompressionStream.

A normal export sends `Content-Encoding: gzip`. The exit flush stays plain JSON inside the keepalive budget. If compression is missing or fails, the request stays plain JSON. A host `send` still receives the plain JSON string.
