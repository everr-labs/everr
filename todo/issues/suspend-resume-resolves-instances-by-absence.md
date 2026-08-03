# Suspend/resume resolves every instance by absence, then refires it

## What
When the machine running the engine is suspended and resumed (laptop sleep, Docker Desktop VM pause), the first evaluations after wake resolve firing instances across every source at once, then refire them seconds later. The event history and delivery pipeline fill with phantom resolve/fire pairs that no signal ever produced.

## Evidence (dev stack, 2026-07-30)
- Flap clusters at 19:37, 19:53, 20:06, 20:22, 20:37, 20:54, 21:07, 21:13; none overnight; none during steady operation.
- Each flap: instances across all four demo sources (`demo/demo-always-burning` slow-burn + ticket, `demo/demo-slow-leak` ticket, `demo/demo-always-firing`, `demo/demo-flapping`) resolve with one identical timestamp, refire 4 to 9 seconds later.
- `demo/demo-slow-leak`'s SLI is pure arithmetic over the window bounds (no table); its burn is 1.2x by construction and its refire evidence says exactly that. The signal cannot flap; the state machine did.
- Engine traces around the 20:54 flap: a 2.5+ minute hole with zero spans, then `scheduler.tick` taking 9.9s, `queue.consume` spans of 3 to 6s, the resolve batch published by `outbox.relay` at the wake instant, refires on the next `scheduler.tick_slos`. No engine restart (single boot log at 11:20, maintenance still running at 23:30). That is a suspend/resume signature, not a crash.

## Where
- `crates/clickety-clack/src/engine/state_machine.rs`: absence is counted per evaluation; rules with `resolve_after: 1` resolve on a single absent evaluation.
- `crates/clickety-clack/src/evaluator/slo.rs`: recomputed-empty windows prune absent groups from the snapshot; a pruned group's instance is resolved by absence (see the "resolved-by-absence has no source" comment), bypassing the `TierVerdict::Unknown` hold that exists to stop data-gap flapping.
- After a pause, evaluation windows cover wall-clock time in which nothing was ingested, so "absent" is true of everything simultaneously.

Unpinned detail: the constant-SLI slow-leak resolve is stamped at outbox relay time rather than at an evaluation tick, so the resolve decision appears to happen at the pause boundary and only publish at wake. The exact code path deciding that resolve was not identified.

## Why it matters
- Phantom transitions pollute the audit trail and get delivered to receivers (resolve notification followed by a fresh page for the same ongoing problem).
- In production the trigger is rarer but real: VM pauses, live migration, cgroup freezes, long stop-the-world stalls.
- Dev stacks hit it constantly, which makes the demo fixtures look broken and trains users to distrust the event history.

## Sketch
- Detect evaluation-time discontinuity: if `eval_ts` jumped more than N x the evaluation interval since the previous tick, treat the first evaluation(s) after the jump as state-holding: skip the absence path (do not advance `absent_count`, do not prune snapshot groups) until one full window of post-wake data exists.
- Alternatively (or additionally) make absence advance only when the queried window actually overlapped time the engine was alive. (The steady-state ingestion-delay tail is already handled: SLI windows end `CC_SLO_INGEST_DELAY_SECS` before the evaluation instant.)
- Pin down and align the resolve-event timestamping (outbox relay vs evaluation tick) so the event log records when the state changed, not when it was published.

## Related
[slo-short-window-floor-vs-sparse-telemetry](slo-short-window-floor-vs-sparse-telemetry.md): the `TierVerdict::Unknown` hold fixed empty-window flapping for present groups; this issue is the absence path around it. Found investigating why demo SLOs flap between firing and resolved during active dev hours.
