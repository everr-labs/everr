---
"@everr/otel-web": minor
---

Remove `pageLoad()`, rage clicks, form change events, click coordinates, and scroll depth.

`pageLoad()` no longer emits a load root, asset spans, or long-animation-frame spans. A browser request span is its own trace. LCP and TTFB attribution still describe why a load was slow.

`interactions()` no longer emits `everr.browser.interaction.rage_click` or `everr.browser.interaction.change`. Clicks no longer carry `everr.browser.click.x` or `everr.browser.click.y`.

`everr.browser.page_leave` no longer carries `everr.scroll.depth`. It still carries `everr.page_view.duration`.
