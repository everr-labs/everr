# 16: Actor plumbing

**What to build:** Every alerting mutation knows who performed it, derived
on the server, never from the client. The client-controlled silence author
field is replaced, not kept beside the real actor.

**Details:** issue 19 in `../03-alerting-surface-plan.md`; finding 20 in
`../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] An actor argument threads through the session-narrowing boundary that covers every mutation path
- [ ] The actor derives from the authenticated principal (user or API key)
- [ ] The silence author is server-derived; any user-provided display note is stored separately
