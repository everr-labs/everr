# 20: Failed applies do not half-change alerting

**What to build:** When an apply fails partway, alerting configuration is
not left partially changed. The alert reconciler honors the transaction
executor the resource registry supplies.

**Details:** finding 6 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** done

- [x] The supplied executor passes through every alert repository mutation, or the transaction contract is explicitly replaced with a durable convergence protocol
- [x] An integration test where a later resource kind fails after alerting mutations begin. The literal scenario is unreachable, because alerts reconcile last; `pipeline-invariants.integration.test.ts` covers the reachable half, a throwing transaction leaving no enqueued job behind

Record check 2026-08-10: the executor is threaded through every mutation and
the reconcile loop runs in one transaction. The existing tests assert the
plumbing against mocks; no test exercises a real rollback across kinds.
