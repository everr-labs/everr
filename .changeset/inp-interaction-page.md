---
"@everr/otel-web": patch
---

The INP vital and its `slow_interaction` span now carry the page view where the input happened. Before, they carried the page that was current when the SDK sent them, which could be a page that the app navigated to later.
