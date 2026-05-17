<p align="center">
  <img src="packages/app/public/everr.svg" height="60" alt="Everr" />
</p>

<h3 align="center">Software delivery intelligence for developers and AI agents, local, CI, and production.</h3>

<p align="center">
  <a href="https://everr.dev">Website</a> &middot; <a href="https://everr.dev/docs">Docs</a> &middot; <a href="https://everr.dev/devlog">Devlog</a> &middot; <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--ALv2-blue" alt="License" /></a>
</p>

---

Observability today is trapped behind dashboards, and most "AI integrations" are just legacy tooling with a ChatGPT wrapper slapped on top.

Everr gives you, and your AI agents, direct access to the signals that matter, wherever your code runs: on your laptop, in CI, and in production.

## The problem

AI coding agents are making development faster than ever. Reading the codebase tells half the story; the other half is what the code actually *does* the moment it runs, and that half is usually trapped behind a dashboard the agent can't see.

By the time a regression shows up in a production graph, it's already too late. The bottleneck has moved from writing code to validating it.

## How Everr helps

**Think in Code.** Everr exposes the same OpenTelemetry data, local, CI, and cloud, behind a read-only SQL surface. Agents already know how to write SQL, so they can answer "show me flaky failures on `main` last week" without us shipping a new endpoint for every shape of question. No screen-scraping, no log parsing, no custom RPC per workflow.

**Built where the work actually happens.** A local collector with an in-process ClickHouse, a CI integration that captures every workflow run, and a hosted backend that ties them together. Same primitives, same data, same answers, whether the agent is on your laptop, a sandbox in the cloud, or a teammate's machine three time zones away.

**Editor- and agent-agnostic.** VS Code, Cursor, Zed, JetBrains, Claude Code, Codex, Copilot, Everr doesn't replace your stack, it improves it. Bundled skills slot directly into the assistants you already use, so they reach for runtime data the moment a test fails or a span goes missing.

### Key capabilities

- **Local telemetry, queryable on the spot**, A sidecar collector embeds [chDB](https://clickhouse.com/docs/chdb) and exposes OpenTelemetry data from your dev server, tests, or any wrapped command over SQL. `everr local query "<SQL>"` from the terminal; the same data drives charts and a logs explorer in the desktop app.
- **CI observability**, Every GitHub Actions workflow run becomes a structured trace with flakiness scores, performance trends, failure patterns, and cost breakdowns. No YAML changes, no config files.
- **Production observability**, send the same OpenTelemetry data to any standard OTLP collector so it's available in your existing dashboards, or to local agents alongside everything else they already see.
- **Bundled agent skills**, `everr skills install` drops CI debugging, local telemetry setup, and local debugging skills into Claude Code, Codex, or Cursor, globally or per project, kept in sync via `everr skills update`.

## Get early access

Everr is currently in closed beta. [Join the waitlist](https://everr.dev/waitlist) to get access.

- **For CI**: install the GitHub App on your repositories, no YAML changes, no config files, no modifications to your workflows.
- **For local**: install the CLI and run `everr local start` to bring up the collector alongside your dev server, tests, or agent terminal.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup instructions.

## License

This project is licensed under the [Functional Source License, Version 1.1, ALv2 Future License](LICENSE). Some components are subject to different license terms, see [NOTICE](NOTICE) for details.
