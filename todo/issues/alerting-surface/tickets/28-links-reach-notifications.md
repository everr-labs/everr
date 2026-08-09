# 28: Alert and runbook links reach notifications

**What to build:** A notification carries a working link to the alert
detail or the runbook. Apply already generates the annotations and the
senders already support a URL; the middle is missing.

**Details:** finding 18 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] Link selection is defined when both the alert detail and the runbook exist
- [ ] The selected URL carries from the definition through the event to the channel
- [ ] Event-to-channel coverage
