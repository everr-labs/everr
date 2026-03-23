<p align="center">
  <img src="packages/app/public/everr.svg" height="60" alt="Everr" />
</p>

<h3 align="center">Software delivery intelligence for developers and AI agents.</h3>

<p align="center">
  <a href="https://everr.dev">Website</a> &middot; <a href="https://everr.dev/docs">Docs</a> &middot; <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--ALv2-blue" alt="License" /></a>
</p>

---

Everr transforms your CI/CD pipelines into fully observable systems. It collects structured telemetry from GitHub Actions and turns it into actionable signals -- so both developers and AI coding agents can detect failures, understand root causes, and resolve issues fast.

<!-- TODO: Add a product screenshot here
<p align="center">
  <img src="assets/screenshot.png" alt="Everr dashboard" width="800" />
</p>
-->

## The problem

AI coding agents are making development faster than ever. But every change still has to pass through CI -- and when pipelines break, everything stops.

Developers context-switch between dashboards and raw logs. AI agents hit a wall because pipeline data is fragmented and unstructured. **The bottleneck has moved from writing code to validating it.**

## How Everr helps

**Structured telemetry, not raw logs.** Every workflow run is converted into OpenTelemetry traces. Everr automatically surfaces flakiness scores, performance trends, failure patterns, and cost anomalies.

**Built for humans and agents.** The same structured data is accessible through the web dashboard, a native desktop app, and a CLI designed for AI-native workflows. Agents can query pipeline status, search logs, and act on failures autonomously -- no screen-scraping, no log parsing.

### Key capabilities

- **Full run tracing** -- Trace waterfall, structured logs, and resource usage for every workflow run. Debug failures in seconds.
- **Flaky test detection** -- Heatmaps and timelines that track flakiness over time. Stop re-running and start fixing.
- **Cost visibility** -- Runner spend broken down by repo, workflow, and runner type. Find what's burning your budget.
- **Performance trends** -- Spot slowdowns across repos, branches, and jobs before your team feels them.
- **AI-native CLI** -- Query status, search logs, and surface slow tests from your terminal -- or let your agent do it.

## Get early access

Everr is currently in closed beta. [Join the waitlist](https://everr.dev/waitlist) to get access.

Once you're in, just install the GitHub App on your repositories -- no YAML changes, no config files, no modifications to your workflows.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup instructions.

## License

This project is licensed under the [Functional Source License, Version 1.1, ALv2 Future License](LICENSE). Some components are subject to different license terms -- see [NOTICE](NOTICE) for details.
