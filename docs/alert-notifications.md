# Alert Notification Configuration

Alert delivery is handled by the clickety-clack engine. The org-level
notification settings dialog this document used to describe (Telegram/Slack
entries stored in `alert_settings.delivery`) was removed with the CC cutover;
its tables (`alert_definitions`, `alert_settings`, `alert_silences`) no longer
exist.

Delivery is now configured on the **Alerts -> Delivery** page as three
resources: channels (endpoint configs; secrets encrypted at rest and redacted
on read), receivers (named sets of channels), and routes (matcher-based
routing with grouping, repeats, and priorities). Silences and inhibitions live
on their own pages. Alert rules and SLOs themselves stay as-code via
`everr apply`.

Where the real documentation lives:

- User guide: `packages/docs/content/docs/guides/set-up-notifications.mdx`
- Engine how-to: `crates/clickety-clack/docs/how-to/configure-receivers-and-routing.md`
- Engine reference (API and data model): `crates/clickety-clack/docs/reference/`

Migration of pre-cutover tenant delivery settings is tracked in
`todo/issues/alerts-cutover-tenant-migration.md`.
