# Pattern matching for alerting matchers

Matchers (routes, silences, inhibitions) are exact match only (`eq`/`ne`)
since the 2026-08-09 decision that removed `regex`/`notregex` instead of
hardening them (alerting-surface ticket 22). Users who want "silence
everything under `checkout-*`" have no way to say it short of listing
values.

Idea: bring pattern power back safely. Candidates, in rough order of
preference:

- A bounded glob op (`*` only, linear-time by construction), which covers
  most real uses (prefix and suffix matching) with trivial semantics.
- A linear-time regex engine (RE2-family) behind the existing op names,
  with limits on matcher counts, pattern lengths, and matched value
  lengths, and a bounded compiled-pattern cache.

Whatever lands must keep the property that removal bought: no
user-provided pattern can exhaust CPU or memory. Removing the ops retired
that risk by construction (see
`../issues/alerting-surface/05-what-shipped.md`).

Watch for the frozen `silence_matchers_json` on ClickHouse rows: new ops
appear in frozen history, so the skill file's description of matcher
semantics must stay versionless (describe ops as data, not as an
exhaustive set).
