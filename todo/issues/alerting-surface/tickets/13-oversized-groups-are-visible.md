# 13: An oversized notification group is visible

**What to build:** A group that holds more members than one flush may claim
says so, instead of being diagnosable only by reading the membership table.
Demo: drive 600 firing instances of one rule into a group; the flush that
hits the cap emits a counter and a log line naming the group, the claimed
count and the remainder.

**Details:** found 2026-08-11 alongside the claim-ordering fix
(`delivery/journal-reader.ts`). `FLUSH_GROUP_MEMBER_CLAIM_CAP` bounds what
one flush claims, and the leftover drains over later flushes. Nothing
reports that this is happening. The starvation bug that made the leftover
undeliverable forever was invisible from outside for the same reason: a
group can be stuck at the cap, and the only evidence is a row count in
`alert_notification_group_events`.

The default grouping is `["rule", "severity"]`, so every firing instance of
one rule shares a group. Any rule that goes wide reaches the cap in a single
evaluation, which makes this a normal operating condition rather than an
exotic one.

**What "visible" needs to cover:**

- A flush that claims exactly `cap` rows, and finds more unflushed behind
  them, is a capped flush. Count it, and name the group.
- The notification itself already says "…and N more" for what it claimed
  (`BODY_MAX_EVENTS`). It says nothing about what it could not claim, so a
  reader cannot tell a 500-instance storm from a 5000-instance one.
- The drain now paces at one group interval per flush (ticket's sibling
  change), so a 5000-member group takes ten intervals to report fully. That
  is a deliberate trade, and it should be legible when it happens.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] A capped flush is counted, with the group and the unclaimed remainder
- [ ] An oversized group is diagnosable without querying the membership table
- [ ] The reference documents the cap, the drain rate, and what a reader should conclude from a capped flush
