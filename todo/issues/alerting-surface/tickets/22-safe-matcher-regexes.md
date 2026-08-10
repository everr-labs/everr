# 22: Remove regex matchers

**What to build:** Matcher regexes are removed instead of hardened
(decided 2026-08-09). The shared matcher op enum drops `regex` and
`notregex`; route matchers, silence matchers, and inhibition matchers
become exact match only (`eq`/`ne`). Empty matchers stays the catch-all
mechanism. This retires finding 10 (catastrophic backtracking, unbounded
regex cache) by construction: no user pattern ever reaches `RegExp`.

Safe pattern matching (linear-time regex or a bounded glob) is a
follow-up idea in `../../../ideas/alerting-matcher-patterns.md`, not part
of this branch.

**Details:** finding 10 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately. In the merge gate.

**Status:** ready-for-agent

- [x] `regex` and `notregex` are removed from the matcher op enum and every consumer (routing resolution, silences, inhibitions)
- [x] Apply rejects specs that still use the removed ops, with a clear error
- [x] The regex evaluation path and its process-wide cache are deleted
- [x] Matcher counts and value lengths keep sane bounds at the schema boundary
