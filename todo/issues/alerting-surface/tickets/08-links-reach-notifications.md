# 8: Alert and runbook links reach notifications

**What to build:** A notification carries a working link to the alert
detail or the runbook. Apply already generates the annotations and the
senders already support a URL; the middle is missing.

**Evidence:**

- `packages/app/src/data/alerting/rules/resource/mapping.ts:62`
- `packages/app/src/server/alerting/evaluation/rule.ts:319`
- `packages/app/src/server/alerting/delivery/flush-group.ts:29`

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

**Progress (2026-08-16):** The generation half exists: apply writes both links into annotations (`rules/resource/mapping.ts`), and `context_json` freezes them onto ClickHouse lifecycle rows. Neither link reaches a notification. The composed message carries only the alert page URL, and protects it from truncation.

- [ ] Link selection is defined when both the alert detail and the runbook exist
- [ ] The selected URL carries from the definition through the event to the channel
- [ ] Event-to-channel coverage
