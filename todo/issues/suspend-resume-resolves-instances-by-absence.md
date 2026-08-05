# Suspend/resume resolves rule instances by absence, then refires them

## What
When the machine running the engine is suspended and resumed (laptop sleep, Docker Desktop VM pause), the first rule evaluations after wake resolve firing instances by absence, then refire them seconds later. The event history and delivery pipeline fill with phantom resolve/fire pairs that no signal ever produced.

## Evidence (dev stack, 2026-07-30)
- Flap clusters at 19:37, 19:53, 20:06, 20:22, 20:37, 20:54, 21:07, 21:13; none overnight; none during steady operation.
- Each flap: the continuously firing demo rules resolve with one identical timestamp, then refire 4 to 9 seconds later.
- Engine traces around the 20:54 flap: a 2.5+ minute hole with zero spans, then `scheduler.tick` taking 9.9s and `queue.consume` spans of 3 to 6s. No engine restart occurred. That is a suspend/resume signature, not a crash.

## Where
- `crates/clickety-clack/src/engine/state_machine.rs`: absence is counted per evaluation; rules with `resolve_after: 1` resolve on a single absent evaluation.
- After a pause, evaluation windows cover wall-clock time in which nothing was ingested, so "absent" is true of everything simultaneously.

## Why it matters
- Phantom transitions pollute the audit trail and get delivered to receivers (resolve notification followed by a fresh page for the same ongoing problem).
- In production the trigger is rarer but real: VM pauses, live migration, cgroup freezes, long stop-the-world stalls.
- Dev stacks hit it constantly, which makes the demo fixtures look broken and trains users to distrust the event history.

## Sketch
- Detect evaluation-time discontinuity: if `eval_ts` jumped more than N x the evaluation interval since the previous tick, treat the first evaluations after the jump as state-holding and do not advance `absent_count` until one full window of post-wake data exists.
- Alternatively (or additionally) make absence advance only when the queried window actually overlapped time the engine was alive.
- Pin down and align the resolve-event timestamping (outbox relay vs evaluation tick) so the event log records when the state changed, not when it was published.
