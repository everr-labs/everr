# 30: An event that will never be processed reaches retention

**What to build:** An event that no job will ever process again no
longer evades cleanup forever. The end of its processing is recorded
with a timestamp, so retention can collect it. The delivery half of this
leak is ticket 07.

**Details:** finding 21 in `../04-alerting-branch-review.md`.

Cleanup selects events on `processed_at < cutoff`
(`server/alerts/maintenance/cleanup.ts`), so anything left at null is
uncollectable, whatever put it there. Finding 21 named one cause: a
processing job that exhausts every retry. A second cause reaches the same
state and is not a failure at all, so a fix aimed only at failures misses it:

- **A hold whose wake-up is lost.** `deferSuppressedEvent` sets `processed_at`
  back to null for a deferred fire and re-queues the event for when the
  silence lapses. The row waits on that one job. If the job is lost, the
  event stays unprocessed forever, and it also pins the membership row and
  the notification group that hold it. Nothing sweeps for a hold whose wake
  never came.

So the state to record is "no job will process this again", not "processing
failed". Retries in flight and holds waiting on a real future wake-up are
both live, and both must survive the sweep.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] A terminal processing failure state and timestamp are recorded
- [ ] A hold whose wake-up never arrives reaches the same terminal state
- [ ] Active retries and live holds are retained; terminal rows are deleted
      after a safe horizon
