---
"@everr/otel-web": patch
---

Preserve the page context captured when an interaction is first observed on both its INP vital and slow interaction span, so later SPA navigations cannot replace their URL, route, or page-view ID.
