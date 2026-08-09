# 20: Failed applies do not half-change alerting

**What to build:** When an apply fails partway, alerting configuration is
not left partially changed. The alert reconciler honors the transaction
executor the resource registry supplies.

**Details:** finding 6 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] The supplied executor passes through every alert repository mutation, or the transaction contract is explicitly replaced with a durable convergence protocol
- [ ] An integration test where a later resource kind fails after alerting mutations begin
