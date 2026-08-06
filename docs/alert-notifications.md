# Alert Notification Configuration

Alert delivery is handled by the Everr application worker. Rule evaluation,
state transitions, notification grouping, and delivery retries run as Graphile
Worker jobs. Durable alert state and job state live in the application Postgres
database. ClickHouse remains the query target for alert rules and SLOs.

Delivery is now configured on the **Alerts -> Delivery** page as three
resources: channels (endpoint configs; secrets encrypted at rest and redacted
on read), receivers (named sets of channels), and routes (matcher-based
routing with grouping, repeats, and priorities). Silences and inhibitions live
on their own pages. Alert rules and SLOs themselves stay as-code via
`everr apply`.

Related documentation:

- User guide: `packages/docs/content/docs/guides/set-up-notifications.mdx`
- Architecture decision: `docs/adr/0004-run-alerting-on-graphile-worker.md`
