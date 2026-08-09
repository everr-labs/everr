# 16: Actor plumbing

**What to build:** Every alerting mutation knows who performed it, derived
on the server, never from the client. The client-controlled silence author
field is replaced, not kept beside the real actor.

**Details:** issue 19 in `../03-alerting-surface-plan.md`; finding 20 in
`../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [x] An actor argument threads through the session-narrowing boundary that covers every mutation path
- [x] The actor derives from the authenticated principal (user or API key)
- [x] The silence author is server-derived; any user-provided display note is stored separately (the existing `comment` column)

**Left for ticket 17:** the as-code rule mutations (`createRule`, `updateRule`,
`adoptRule`, `deleteRule`) still take an organization id. They are reached
through `applyResources` and the resource registry, not through a server
function, so the actor has to travel with the apply options rather than with
the session. The apply boundary already publishes it as `context.actor`, so
ticket 17 threads that value down instead of deriving it again.
