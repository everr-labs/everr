---
name: 007-web-vitals-long-tasks
title: How are web vitals and long tasks best captured, and what log shape should they have?
labels: [wayfinder:research]
status: closed
assignee: research-subagent
blocked-by: []
---

## Question

What is the state of the art for capturing Core Web Vitals (LCP, CLS, INP, TTFB, FCP) and long tasks in the browser: the web-vitals library vs raw PerformanceObserver, attribution data, when values finalize (visibilitychange), and delivery via sendBeacon or fetch keepalive? What attributes should each measurement carry so it lands well as an OTel log record? Check whether OTel semantic conventions for browser or web vitals exist.

Findings: research/007-web-vitals-long-tasks.md

## Resolution

- Use the web-vitals v5 attribution build (onLCP, onCLS, onINP, onFCP, onTTFB; FID is removed in v5). TTFB and FCP fire early; LCP finalizes on interaction or page hide; CLS and INP report on visibility hidden (possibly multiple times, dedupe by metric id) and again after bfcache restore.
- Delivery: queue callbacks, flush on visibilitychange to hidden (plus pagehide for Safari), send via sendBeacon with fetch keepalive fallback.
- Jank: prefer Long Animation Frames (Chrome 123+, script-level attribution: sourceURL, functionName, invoker, blockingDuration) over longtask entries (frame-container attribution only). Both are Chromium-only, and web-vitals v5 already embeds LoAF data in INP attribution, so a standalone longtask observer is not worth shipping.
- SPA: browsers pin all vitals to the initial hard-navigation URL, and CLS and INP accumulate across routes; record the landing page.url plus the TanStack route pattern at report time. The Soft Navigations API is still an origin trial, so design in navigation_id and navigation_url now and enable later.
- OTel alignment: semconv defines a browser.web_vital event (Development stability) and the experimental opentelemetry-browser package emits log records with browser.web_vital.name/value/delta/id/rating/navigation_type. Recommendation: hand-roll the collection but adopt those exact attribute names, extending attribution fields under the same namespace.

Full detail, including the per-metric attribute table: research/007-web-vitals-long-tasks.md
