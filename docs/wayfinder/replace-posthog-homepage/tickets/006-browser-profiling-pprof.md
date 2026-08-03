---
name: 006-browser-profiling-pprof
title: Can browser profiles be captured and converted to pprof, and at what cost?
labels: [wayfinder:research]
status: closed
assignee: research-subagent
blocked-by: []
---

## Question

Is the JS Self-Profiling API a viable capture mechanism (browser support, sampling resolution, overhead, required response headers like Document-Policy), and can its output be converted to pprof format for Everr's profiling pipeline? What do existing tools do (Sentry browser profiling, Firefox profiler formats)? Outcome: a feasibility verdict with constraints, so the profiling scope ticket can decide whether browser profiling makes the spec or gets cut.

Findings: research/006-browser-profiling-pprof.md

## Resolution

Verdict: viable with caveats.

- The JS Self-Profiling API (Profiler) works but is Chromium only (Chrome/Edge 94+, roughly 76% global coverage). Firefox has cross-origin-isolation concerns and WebKit is negative, so there is no cross-browser path.
- It requires a Document-Policy: js-profiling response header on the homepage document; a host that cannot set headers cannot use it.
- Chrome clamps the sample interval to 10ms (Mac/Linux/Android) or 16ms (Windows), roughly 100Hz. Overhead is under 1% of load time per Facebook field data; a 7s trace is about 25 KB of JSON and compresses well.
- Sentry ships exactly this (beta): browserProfilingIntegration converts the ProfilerTrace to their sample format, structurally the same shape as the raw trace.
- The pprof mapping is clean (frames to Function/Location, parent-linked stacks flatten leaf-first, timestamps to weighted values). No existing ProfilerTrace-to-pprof converter was found, but Datadog's pprof-format package (pure JS profile.proto encoder, browser-capable) makes the glue small.
- Alternatives: Chrome DevTools protocol is lab-only; longtask entries have no attribution; LoAF (Chrome 123+) is the best fallback but script-level only and still Chromium-only.
- Gotchas: cross-origin scripts are silently dropped without CORS opt-in, stop() never resolves during unload, minified frame names need source maps to be readable.

Full detail: research/006-browser-profiling-pprof.md
