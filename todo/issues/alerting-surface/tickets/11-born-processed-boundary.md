# 11: The born-processed pipeline boundary

**What to build:** State-only journal rows can never be delivered, as a
property of the module boundary. The delivery pipeline reads its work
through one function that hard-codes the notifying kind, and nothing else
queries the journal for deliverable events.

**Details:** issue 14 in `../03-alerting-surface-plan.md`.

**Blocked by:** 03.

**Status:** ready-for-agent

- [x] One reader function selects only notifying events (`delivery/journal-reader.ts`, 2026-08-09)
- [x] No other code path queries the journal for deliverable events (process-event and flush-group both read through the module)
- [x] A test proves a state-only event never reaches delivery (`journal-reader.test.ts` pins the `kind = 'notifying'` WHERE clause on both reads)
