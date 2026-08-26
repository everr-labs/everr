---
"@everr/otel-web": minor
---

`pageLoad()` now emits one `PageLoad` root span per first load, starting at the document time origin and ending at LCP. The asset spans are its children and are named `pageLoad.asset.<initiator_type>` (for example `pageLoad.asset.script`) instead of `GET asset:<initiator_type> <url>`, so the span name is stable across deployments; the resource URL stays in `url.full`. The root also goes out when the page becomes hidden before the window stops, so a short visit still ships a complete trace. The recording window (load + `settleMs`, or `ceilingMs`) is unchanged.
