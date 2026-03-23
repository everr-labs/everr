# Everr

**Software delivery intelligence for developers and AI agents.**

Everr transforms your CI/CD pipelines into fully observable systems. It collects structured telemetry from GitHub Actions and turns it into actionable signals -- so both humans and AI agents can detect failures, understand root causes, and resolve issues fast.

## The problem

AI coding agents are making development faster than ever. But every change still has to pass through CI -- and when pipelines break, everything stops. Developers context-switch between dashboards and logs. AI agents hit a wall because pipeline data is fragmented and unstructured. The bottleneck has moved from writing code to validating it.

## What Everr does

**Structured telemetry, not raw logs.** Everr converts every workflow run into OpenTelemetry traces and automatically surfaces what matters: flakiness scores, performance trends, failure patterns, and cost anomalies.

**Built for both humans and agents.** The same structured data is accessible through the web dashboard, a native desktop app, and a CLI designed for AI-native workflows. Agents can query pipeline status, search logs, and act on failures autonomously.

- **Every run, fully traced** -- Drill into any workflow run with a trace waterfall, structured logs, and resource usage. Debug failures in seconds, not hours.

- **Flaky test detection** -- Track test flakiness over time with heatmaps and timelines. Stop re-running pipelines and start fixing root causes.

- **Cost visibility** -- Break down runner spend by repository, workflow, and runner type. Find the workflows burning through your budget.

- **Performance trends** -- Spot slowdowns before your team feels them. Track duration trends across repos, branches, and jobs.

## How it works

Install the Everr GitHub App on your repositories. That's it -- no YAML changes, no config files, no modifications to your workflows. Everr starts collecting data immediately.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and architecture details.

## License

This project is licensed under the [Functional Source License, Version 1.1, ALv2 Future License](LICENSE).

Some components are subject to different license terms. Refer to [NOTICE](NOTICE) for attribution and licensing details.
