# Short SLI windows sit below the resolution of sparse telemetry

## The problem
The floored 60s short window (`SHORT_WINDOW_FLOOR_SECS`, domain/slo.rs) is
often smaller than the gaps between rows of the data it measures. Originally
measured over one active dev hour: 11.7% of 30s eval ticks saw an empty
trailing 60s window.

## Fuller measurement (2026-08-03, dev stack, 24h, 30s ticks, ingest shift applied)

| service | gap p50 | gap p90 | empty 60s | empty 70s | empty 12m |
|---|---|---|---|---|---|
| alert | 34s | 182s | 62% | 57% | 4% |
| everr-dev-app | 0s | 202s | 93% | 92% | 62% |
| github-actions | 0s | 0s | 97% | 97% | 86% |

Two findings that reframe the issue:

1. **It is not about the floor.** Over a full day (idle hours included) even
   the 12-minute long window is empty most of the time for bursty services.
   A 7d SLO's un-floored 70s short window is as empty as a 1d SLO's floored
   60s one. Sparsity is a property of the telemetry, not of the floor, so
   raising `MIN_WINDOW_SECS` until nothing floors would not fix it.
2. **For count-ratio SLIs, an empty window cannot hide a burn.** The SLI
   counts events from the same stream that carries the badness (error logs
   are rows, failed requests are rows), so a burn implies rows implies a
   measurable window. Empty windows coincide with nothing being emitted at
   all, and silence-as-badness is the dead-man rule's job (the docs already
   mandate pairing). `TierVerdict::Unknown` holds state through gaps and
   `min_valid_events` floors the long window, so the engine's semantics are
   coherent as they stand.

The one real degradation: with a handful of events, short-window burn is
quantized. One bad event in a 60s window at a 99.9% target reads as
hundreds-x burn, so the short gate degenerates to "was there at least one bad
event recently". Its anti-flap half survives intact (zero bad events reads
0x, so a passed spike still stops paging immediately); its confirmation half
is weak.

## Options weighed

- **Raise `MIN_WINDOW_SECS` to ~6d** (so the floor never engages): kills 1d
  SLOs without fixing sparsity at 7d. Rejected.
- **Derive the floor from observed data density**: a feedback loop fed by a
  confounded measurement (a quiet source is indistinguishable from a lagging
  one, the same trap that produced the first draft of the ingest-delay
  analysis). No vendor does this. Rejected.
- **Drop floored tiers instead of evaluating them**: at 1d that removes the
  only critical tier and leaves ticket-only paging. Rejected.

## What Grafana and Datadog do (checked 2026-08-03)

Both refuse to create the situation rather than solve it:

- **Datadog**: SLO windows are 7/30/90d only; burn-rate long window is bounded
  to 1h..48h with short auto-derived as long/12, so their smallest
  confirmation window is 5m (5x our floor). For low-traffic services the docs
  point at the SRE Workbook's answers: synthetic traffic, or their separate
  **error-budget-consumed alert type**, which needs no short window at all.
- **Grafana Cloud SLO**: minimum SLO window 7d (default 28d); smallest
  alerting window 1h. Their explicit low-volume knob is **Minimum Failures**:
  the alert cannot trigger until at least N failures are observed, applied to
  every alerting window.

Takeaways: our 60s/12m floor is already 5-60x more permissive than either
vendor and our 1d minimum window is below what either will create, so keeping
1d SLOs is capability, not debt. Nobody derives windows from density.
Grafana's Minimum Failures is the one idea worth stealing: gating windows on
the numerator (failures) rather than only the long-window denominator
directly fixes the quantization degeneration above.

## Recommendation

Treat this as a surfacing problem plus one small engine knob, keeping window
math and the 1d capability unchanged.

**Done (2026-08-03): documentation.** The engine how-to gained a "Sparse and
low-traffic SLIs" section (what stays correct, what degrades, remedies) and
the product docs' how-slos-work page gained "Data gaps and low traffic"
(hold semantics, `minValidEvents`, longer windows, dead-man pairing).

Remaining:

1. **Apply-time density note.** The SLO validation probe already runs the SLI
   over the full budget window, so `valid / window_secs` is the average event
   rate for free. When `rate x scaled_short_window` is small (roughly under 5
   expected events), emit an apply note (not an error): the SLI averages ~N
   events per short window, burn confirmation will be coarse, consider a
   longer window or `min_valid_events`. The CLI already prints per-kind apply
   notes, so the plumbing exists.
2. **Optional: a minimum-failures gate on the short window** (Grafana-style),
   so one stray bad event in a sparse window cannot satisfy the confirmation
   gate. This is the only engine-side change with real precedent.
3. Bigger, later: an error-budget-consumed alert type as the low-traffic
   escape hatch (Datadog's shape), sidestepping windows entirely. Belongs
   with the rollups idea, not here.

## Related
Found while debugging `demo/demo-always-burning` resolving and re-firing every
few minutes. That flapping was fixed by making a data gap hold the tier's
state instead of resolving it. The ingestion-delay half of the original
investigation shipped separately (`CC_SLO_INGEST_DELAY_SECS`, engine and app
read-time scans alike).
