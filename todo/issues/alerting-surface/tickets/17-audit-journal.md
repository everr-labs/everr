# 17: The audit journal

**What to build:** "Who changed what, when, and what it was before" is
answerable in the application. One audit row per qualifying mutation,
committed at the mutation boundary, in PostgreSQL only. No mutation path
can skip it.

**Details:** issue 20 in `../03-alerting-surface-plan.md`, and step 10's
decision list in `../02-alerting-clickhouse-surface.md`.

**Blocked by:** 16.

**Status:** ready-for-agent

- [ ] The suppression-affecting mutation set is covered (decided 2026-08-09): rule pause/resume/delete, silence create/cancel plus system expiry, inhibition and route changes; everything else is ticket 31
- [ ] The actor column shape is `actor_kind` + `actor_id` + `actor_display`; system actions record `actor_kind = 'system'`
- [ ] Full spec snapshot per qualifying mutation, redacted through a typed per-channel-type schema: no webhook URLs, tokens, or recipient lists
- [ ] The enforcement boundary makes skipping audit unrepresentable
- [ ] The application reads and displays the trail
