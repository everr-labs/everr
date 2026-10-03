# Docs information architecture: page list

**Date:** 2026-08-21
**Labels:** docs, information-architecture
**Status:** proposed

Target structure for `packages/docs/content/docs`. 42 pages, 7 top level groups, one level of nesting.

## Decisions

| Question | Answer | Why |
| --- | --- | --- |
| Who reads the docs | A developer evaluating Everr against Sentry, Grafana, BetterStack | The sell is not finished when they arrive, so explanation has to carry weight |
| The claim | Full stack observability, easy to set up, friendly to Agents | |
| What "full stack" means | Layers: browser, server, database | Matches what a reader arriving from Datadog assumes |
| Layers in navigation | No, narrative only | One instrumentation path, coverage shown on Welcome |
| What the User does | Install, ask the Agent to instrument, verify | The Agent does the instrumentation, via skills |
| Shape of the middle | Verbs, like Sentry Product docs | The navigation itself shows what the product does |
| Concepts group | Removed | Each explanation sits next to the task it explains |
| Guides group | Removed | A flat Guides list produced 11 near identical pages |
| Integrations group | Renamed to Instrument | Verb, consistent with the other groups |
| Dashboard pages | One, not two | There is no dashboard editor in the app. Dashboards are `*.dashboard.yaml` applied with `everr apply` |
| Orgs, Projects, Members | Not documented as a group | Setup is `everr setup` with GitHub. API Keys go to Reference |
| Custom reports | New page, in Investigate | An answer, frozen and shareable |
| Runbooks | Read and run by both Users and Agents | |

Organizing rule: **Measure is what you watch continuously. Investigate is what you answer once.**

## Page list

### Welcome

Single page, no children. What Everr is, in two sentences. Interactive diagram of the request path, with each hop marked as instrumented. Screenshots. Three links out: Instrument, Investigate, Reference.

### Getting Started

1. **Install.** CLI, `everr setup`, Everr Desktop and the Collector, skills for the Agent.
2. **Instrument your app.** One prompt to the Agent. What the Agent writes, so the reader can inspect it.
3. **See your data.** First query, first dashboard. This is the conversion moment.
4. **What is OpenTelemetry.** Background. Last, and skippable.

### Instrument

1. **Browser.** `@everr/otel-web`, Web Vitals, errors, clicks.
2. **Node and TypeScript services.**
3. **Next.js.**
4. **TanStack Start.** The stack this repository runs.
5. **Postgres.**
6. **Kubernetes.**
7. **GitHub Actions.** CI telemetry, and where an API Key is used.
8. **Anything else.** How to send telemetry from anything OpenTelemetry supports.
9. **Verify your telemetry.** Exercise the path, query Local for fresh rows, filter by `ServiceName` and a run id. Failure modes: stopped Collector, wrong service name, dev build only. Do not trust the absence of exporter errors.

Each page is short and ends with the Agent path.

### Investigate

1. **Ask your agent.** MCP and skills. The default way to use Everr.
2. **Query with SQL.** Read only SQL, the tables, the escape hatch for a reader who does not trust the Agent.
3. **Find why CI got slower.**
4. **Investigate a production incident.**
5. **Trace a request end to end.** Browser to server to database. The only page that proves the full stack claim.
6. **Custom reports.** The Agent builds an interactive HTML file from Everr data, to send to a person who does not use Everr. A report is a snapshot, not a live view. The page must say so.

### Measure

1. **Built-in dashboards.** What ships by default and what each one answers.
2. **Dashboards as code.** YAML in the repository, `everr apply`, the `everr-setup-resources` skill, forking a built-in dashboard.
3. **Web Vitals.** Frontend performance over time.

### Automate

1. **Built-in alerts.**
2. **Write a good alert.** Thresholds and noise. The judgement page.
3. **Alerts as code.**
4. **Runbooks.** Linking an alert to a procedure. Read and run by a User or by an Agent.
5. **Notifications.**

### Reference

CLI, MCP server, Skills, API keys, Tables and columns, Telemetry attributes, Dashboard spec, Alert spec, Runbook spec, Visualizations, Variables, Alert queries, Datemath, Retention and limits.

Two are new:

- **Tables and columns.** `traces`, `logs`, `metrics_gauge` and the rest. Load bearing, because Investigate sends readers to SQL.
- **Telemetry attributes.** The `everr.*` catalog and the browser events. Generate this page from `crates/everr-core/assets/skills/everr-use-telemetry/rules/browser-events.md`. Do not write it by hand, or it drifts.

## Migration from the current tree

The current tree has 31 pages in `learn`, `concepts`, `guides`, `reference`.

**Keep, with a new home**

| Now | Target |
| --- | --- |
| `learn/install` | Getting Started / Install |
| `learn/instrument-your-app` | Getting Started / Instrument your app |
| `learn/first-dashboard` | Measure / Dashboards as code |
| `learn/first-alert` | Automate / Alerts as code |
| `learn/add-a-runbook` | Automate / Runbooks |
| `learn/production-telemetry`, `guides/production-telemetry` | Instrument / Node and TypeScript services. Merge the two. |
| `concepts/whats-opentelemetry` | Getting Started / What is OpenTelemetry |
| `concepts/observability-as-code` | Split into Measure / Dashboards as code and Automate / Alerts as code |
| `concepts/how-alerts-work` | Automate / Write a good alert |
| `concepts/how-ci-cost-is-estimated` | Reference, or fold into Instrument / GitHub Actions |
| `guides/browser-telemetry` | Instrument / Browser |
| `guides/debug-ci` | Investigate / Find why CI got slower |
| `guides/cost-analysis` | Measure / Built-in dashboards |
| `guides/resource-monitoring` | Measure / Built-in dashboards |
| `guides/writing-good-alerts` | Automate / Write a good alert |
| `guides/set-up-notifications` | Automate / Notifications |
| `guides/link-alerts-to-runbooks` | Automate / Runbooks |
| `guides/publishing-resources` | Measure / Dashboards as code |
| `guides/setup-new-repo` | Getting Started / Install |
| all of `reference/*` | Reference, unchanged |

**New pages**

Welcome, See your data, Next.js, TanStack Start, Postgres, Kubernetes, GitHub Actions, Anything else, Verify your telemetry, Ask your agent, Query with SQL, Investigate a production incident, Trace a request end to end, Custom reports, Built-in dashboards, Web Vitals, Built-in alerts, Tables and columns, Telemetry attributes, API keys.

## Style

- Answer on the first line. Short paragraphs. Explain with code and with prompt examples, in the style of the Zod docs.
- No em dashes and no en dashes.
- One level of nesting in the navigation, like the TanStack docs.
- Interactive diagrams where they earn their place: the request path on Welcome, a trace waterfall in Investigate.
- Every page that shows the Agent path also shows the SQL or the file, so a skeptical reader can check the work.

## Follow up work

1. Add **Report** to `CONTEXT.md`. The word is now in the navigation and the glossary does not have it.
2. Decide how a built-in dashboard is customized: forked into the repository, or overridden by name. The wording of Measure / Dashboards as code depends on it.
3. Build the generator for Reference / Telemetry attributes.
