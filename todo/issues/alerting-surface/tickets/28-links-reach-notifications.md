# 28: Alert and runbook links reach notifications

**What to build:** A notification carries a working link to the alert
detail or the runbook. Apply already generates the annotations and the
senders already support a URL; the middle is missing.

**Details:** finding 18 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

**Progress (2026-08-16):** The generation half exists: apply writes both links into annotations (`rules/resource/mapping.ts`), and `context_json` freezes them onto ClickHouse lifecycle rows. Neither link reaches a notification. The composed message carries only the alert page URL, and protects it from truncation.

- [ ] Link selection is defined when both the alert detail and the runbook exist
- [ ] The selected URL carries from the definition through the event to the channel
- [ ] Event-to-channel coverage
