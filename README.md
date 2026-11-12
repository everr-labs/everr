<p align="center">
  <img src="packages/app/public/logo.svg" height="60" alt="Everr" />
</p>

<h3 align="center">Observability made simple, for developers and their AI agents.</h3>

<p align="center">
  <a href="https://everr.dev">Website</a> &middot; <a href="https://everr.dev/docs">Docs</a> &middot; <a href="https://everr.dev/devlog">Devlog</a> &middot; <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" /></a>
</p>

---

Everr is an open-source, OpenTelemetry-native observability platform. Logs, traces, metrics, and errors from your laptop, your CI, your backend, and your users' browsers land in one place, queryable with plain SQL by you and by your coding agent.

Most observability tools are built for teams that can afford dedicated telemetry engineers. Everr is opinionated so it delivers value from day one: it guides you from your first span to your first alert, and keeps dashboards, alerts, and runbooks in your repo next to the code they describe.

## Why Everr

**OpenTelemetry, all the way down.** Everr speaks OTLP and follows the OpenTelemetry semantic conventions. No proprietary agents, no lock-in: anything that emits OpenTelemetry can send data to Everr.

**SQL is the query language.** Every signal is stored in ClickHouse and exposed through a read-only SQL surface. Agents already know SQL, so they can answer questions like "which endpoints got slower after yesterday's deploy?" without a bespoke API for every shape of question.

**Observability as code.** Dashboards ([Perses](https://perses.dev/) format), alert rules, and runbooks are files in your repository. Your agent writes them with your codebase as context, and you review them in a PR like any other change.

**Built for AI agents.** Bundled skills teach Claude Code, Codex, Cursor, and other assistants how to instrument code, investigate telemetry, debug CI, and author dashboards and alerts. An MCP server gives any MCP client direct, read-only access to your data.

**Local first.** The CLI runs a local collector with an embedded [chDB](https://clickhouse.com/docs/chdb) and a browser UI, so you and your agent can validate a change with real telemetry before it ever reaches production.

## What's inside

- **Explore**: search logs, inspect traces, and group errors by fingerprint across every service.
- **Dashboards**: built-in dashboards plus your own, defined as YAML with SQL queries.
- **Alerts**: an alert is a SQL query; if it returns rows, it fires. Notifications go to Slack or Telegram, and every alert links to a runbook.
- **Runbooks**: Markdown documents with live panels embedded, written for humans and followed by agents during incidents.
- **Browser telemetry**: [`@everr/otel-web`](packages/otel-web) captures page views, errors, web vitals, and traces from the browser, sent with an origin-bound public key.
- **Instrumentation libraries**: [`@everr/tanstack-start-otel`](packages/tanstack-start-otel) for TanStack Start and [`@everr/otel-errors`](packages/otel-errors) for uncaught Node.js errors.
- **CI observability**: connect the GitHub App and every GitHub Actions run becomes a trace, with logs, flakiness, performance trends, and cost analysis. No workflow changes required.
- **CLI**: `everr local` for the local stack, `everr cloud query` for remote SQL, `everr apply` to publish resources, and `everr skills install` to set up your agent.

## Getting started

1. Install the CLI:

   ```sh
   curl -fsSL https://everr.dev/install.sh | sh
   ```

2. Give your coding agent the Everr skills:

   ```sh
   everr skills install --all --project
   ```

3. Start the local stack and send it telemetry from your dev server or tests:

   ```sh
   everr local start
   ```

4. Connect to [Everr Cloud](https://app.everr.dev/) with `everr cloud login`, or run your own installation with the [Docker Compose guide](deploy/README.md).

From there, follow the [docs](https://everr.dev/docs) to instrument your app, then build your first dashboard and alert.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup instructions.

## License

This project is licensed under the [GNU Affero General Public License, Version 3](LICENSE). Some components are subject to different license terms, see [NOTICE](NOTICE) for details.
