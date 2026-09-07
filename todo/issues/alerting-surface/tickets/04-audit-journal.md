# 4: The audit journal

**What to build:** "Who changed what, when, and what it was before" is
answerable in the application. One audit row per qualifying mutation,
committed at the mutation boundary, in PostgreSQL only. No mutation path
can skip it.

**Details:** step 10 of Order of work, and its decision list, in `../02-alerting-clickhouse-surface.md`.

**Blocked by:** nothing. The actor plumbing it needed has shipped:
`AlertingActor` at the session-narrowing boundary.

**Status:** ready-for-agent

- [ ] The suppression-affecting mutation set is covered (decided 2026-08-09, trimmed 2026-08-18 when inhibitions and routes were removed): rule pause/resume/delete, silence create/cancel plus system expiry, default-destination changes; everything else is ticket 11
- [ ] The actor column shape is `actor_kind` + `actor_id` + `actor_display`; system actions record `actor_kind = 'system'`
- [ ] Full spec snapshot per qualifying mutation, redacted through a typed per-channel-type schema: no webhook URLs, tokens, or recipient lists
- [ ] The enforcement boundary makes skipping audit unrepresentable
- [ ] The application reads and displays the trail
