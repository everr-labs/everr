# 06: Transition reconciliation

**What to build:** A dropped history insert stops being a permanent hole.
One job diffs the journal against ClickHouse and repairs missing
transition rows, idempotently. Demo: suppress an insert, run the
reconciler, the row appears marked as reconciled; run it again, no
duplicate.

**Details:** issue 9 in `../03-alerting-surface-plan.md`; blockers 3 and 4
in the design doc's findings.

**Blocked by:** 02, 03.

**Status:** ready-for-agent

- [ ] One job in a named queue; serial runs as scheduling hygiene
- [ ] Repair inserts are idempotent: deduplication token per stream and id, deduplication window set on the table, insert mode pinned
- [ ] The live insert path carries the same deduplication token and insert mode, so an in-doubt live write converges with its reconciled copy
- [ ] Evaluation failures are journaled on the write path and diffed as their own stream; success rows stay fire and forget
- [ ] The diff filters on `journaled_at`, evaluated on the PostgreSQL clock. It is transaction-start time, not commit time: a row becomes visible up to one transaction duration after its stamp
- [ ] Both window bounds are tested invariants: wider than outage plus retry span plus the longest journal-writing transaction (a slow registry apply), narrower than retention
- [ ] Reconciled rows carry the reconciled write source and the journal timestamp as event time
- [ ] Where the container suite is required for proof, the test is written for it and said so
