# Alert Notification Configuration

Alert delivery is handled by the Everr application worker. Rule evaluation,
state transitions, notification grouping, and delivery retries run as Graphile
Worker jobs. Durable alert state, delivery state, and job state live in the
application Postgres database. ClickHouse stores evaluation evidence and
transition history in addition to serving alert rule queries.

Delivery is configured on the **Alerts -> Notifications** page as two things:
channels (endpoint configs for webhook, Slack, Discord and Telegram; secrets
encrypted at rest and redacted on read), and one organization default
destination that names the channels every alert delivers to. The default
destination is either unsplit (one channel set for all alerts) or split by
severity tier. A rule opts out of it with `spec.notifications.channels` in its
as-code YAML, which then receives that rule's alerts instead.

There is no routing tree: no receivers, no routes and no inhibitions. Grouping
is fixed rather than configurable: every notification batches by rule and
severity, with one wait interval and one pacing interval, and never repeats.
Silences live on their own page and are the only suppression. Alert rules stay
as-code via `everr apply`.

Related documentation:

- User guide: `packages/docs/content/docs/guides/set-up-notifications.mdx`
- Architecture decision: `docs/adr/0004-run-alerting-on-graphile-worker.md`
