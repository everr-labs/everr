---
name: 012-profiling-scope
title: Decide browser profiling scope
labels: [wayfinder:grilling]
status: closed
assignee: guido
blocked-by: [006-browser-profiling-pprof]
---

## Question

Given the feasibility research: does browser profiling make this spec, and if so in what form (sampling policy, which pages, conversion to pprof, where profiles land in Everr)? If feasibility is poor, cut it here and record why, moving it out of scope rather than leaving it in fog.

Constraint inherited from [Decide the error tracking approach for the homepage](009-error-tracking-approach.md): source map symbolication is out of scope for this map, so profiler frames stay minified within this effort. Weigh feasibility accordingly.

## Resolution

Browser profiling is cut from the spec entirely: no capture, no ingestion, and no reserved module slot in the SDK API. It moves to the map's Out of scope section as a possible future effort.

Why:

- Nowhere to land. Everr has no profiling surface today (no pprof ingestion, storage, or flamegraph viewer anywhere in the repo), so shipping it means net-new server-side infrastructure: the same category that ruled out symbolication in [the error tracking decision](009-error-tracking-approach.md), but larger.
- Barely readable without symbolication. Minified frames are a hard constraint of this map, and profiling is the capability that suffers most from it.
- Low value on this deployment. The homepage is a docs site with modest JS, and the JS Self-Profiling API is Chromium-only (~76% coverage), further shrinking what profiles would teach.

Facts settled along the way, for any future profiling effort:

- The homepage host can set response headers (self-hosted Node server in Docker), so the required `Document-Policy: js-profiling` header is not a blocker.
- Capture and pprof conversion are viable per [the feasibility research](../research/006-browser-profiling-pprof.md): under 1% overhead, ~25 KB payloads, small glue via the pprof-format encoder.
- Performance visibility on the homepage is already covered without profiling: web vitals plus LoAF attribution per [the web vitals decision](007-web-vitals-long-tasks.md).
