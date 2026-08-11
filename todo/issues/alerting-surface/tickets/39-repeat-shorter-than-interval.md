# 39: Decide what a repeat shorter than the group interval means

**What to build:** A decision, then whatever it implies. A route may set
`repeat_interval_secs` below its effective `group_interval_secs`, and nothing
in the product has an opinion about it. Decide whether that shape is
legitimate, usually a mistake, or always a mistake.

**Details:** found 2026-08-11 on the dev route, which sets
`repeat_interval_secs: 60` and leaves `group_interval_secs` null, so the
300s default applies. A repeat of an alert the reader already knows about
then goes out five times more often than the first notification of a new one.
`AlertingRouteInputSchema` bounds each field on its own
(`repeat_interval_secs` min 60, `group_interval_secs` min 0) and never
compares them.

The question is open on purpose. "Nag me every minute about what is already
firing, and batch new arrivals into five-minute digests" is a coherent
intent, and it is exactly what the dev route expresses. Alertmanager's
defaults put repeat far above interval, but that is a convention, not
something the semantics require. Do not treat the combination as a bug
without settling this first.

The three answers lead to different work:

- Legitimate. Build nothing. Record the reasoning so the next reader does not
  reopen it.
- Usually a mistake. Warn at apply time and in the delivery UI, and keep
  applying. The warning must name both values, so the fix is obvious from the
  message alone.
- Always a mistake. Reject it in the schema, and carry the routes already
  applied with this shape to something valid. At least one such route exists
  in dev today, so an upgrade path is part of the work, not an afterthought.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] The three readings are weighed and one is chosen, with the reasoning
      recorded
- [ ] Whatever that choice implies is built
- [ ] If the choice rejects a shape already applied, existing routes reach a
      valid state without a manual fix
