# Everr

Software delivery intelligence for developers and AI agents: the same OpenTelemetry data — local, CI, and production — exposed behind a read-only SQL surface. This glossary fixes the canonical word for each domain concept so code, docs, and conversation stay aligned.

## Language

### Tenancy & access

**Organization**:
The top-level account that owns telemetry, dashboards, alerts, runbooks, members, and API keys. The unit of billing and access control.
_Avoid_: workspace, account, tenant (see Tenant)

**Tenant**:
The data-isolation dimension that keeps one Organization's telemetry separate from another's. Conceptually one-to-one with Organization, but named separately because isolation is enforced along this axis.
_Avoid_: using Tenant as a plain synonym for Organization

**Active organization**:
The single Organization a session — or a connected client — is currently acting as; its telemetry is what queries read. For an MCP connection it is chosen when access is authorized and stays fixed for that connection.
_Avoid_: last-used organization, current org, default org

**User**:
A person who uses Everr, typically the developer working on the code. Everr is built for Users and Agents at the same level: its telemetry is meant to be equally usable by a human and by an AI, neither above the other. Belongs to an Organization through a Membership.
_Avoid_: end user, customer

**Member**:
A User's belonging to an Organization, which grants access to its telemetry and resources. Access is decided by current Membership, not by membership at the time access was granted.
_Avoid_: collaborator, seat

**Project**:
A namespace within an Organization for dashboards, alerts, and runbooks, so different teams can reuse the same name without colliding. Defaults to `default`.
_Avoid_: namespace, team

**API Key**:
An Organization-scoped credential with two capabilities: sending telemetry (ingest) and managing resources as code (apply).
_Avoid_: token, secret

### Surfaces & origins

Telemetry comes from three **origins** — Local, CI, and Production — and is read through two surfaces: the local Collector and the Cloud backend. CI and Production telemetry live in the Cloud; Local telemetry lives in the Collector.

**Local**:
Telemetry originating from a developer's machine — dev server, tests, or wrapped commands — received and stored by the local Collector.
_Avoid_: dev, development

**CI**:
Telemetry originating from GitHub Actions, captured automatically as CI runs.
_Avoid_: pipeline

**Production**:
Telemetry originating from live services, sent to the Cloud over OTLP.
_Avoid_: prod, cloud (Cloud is the backend, not this origin)

**Cloud**:
Everr's hosted backend — where CI and Production telemetry is stored and queried. A query surface, not an origin.
_Avoid_: production, hosted, server

**Collector**:
The local sidecar service that receives OpenTelemetry data over OTLP and stores it for on-the-spot querying. The local counterpart to the Cloud.
_Avoid_: agent (an Agent is an AI assistant here), receiver

**Ingestion**:
Receiving telemetry over OTLP and storing it, into either the Collector or the Cloud.
_Avoid_: collection, intake

### Signals

**Signal**:
Collective term for traces, logs, and metrics — the runtime data Everr captures.
_Avoid_: telemetry data, observability data, runtime data

**Trace**:
A tree of spans describing one operation or request. A CI run is represented as a Trace.
_Avoid_: request flow

**Span**:
A single operation within a Trace, carrying timing, status, and attributes.

**Log**:
A timestamped text record emitted during execution, optionally linked to a Trace.
_Avoid_: output, log line

**Metric**:
A numerical time-series measurement, such as a gauge, counter, or histogram.

### Browser telemetry

**WebSDK**:
The browser SDK entry point: constructing it (`new WebSDK({...})`) wires transport, identity, and the configured Instrumentations in one step, with no separate start. `shutdown()` tears everything down; a consent upgrade constructs a new one. Inert on the server and in keyless production builds. The web counterpart to OTel's NodeSDK.
_Avoid_: init (former name), client, browser SDK instance

**Instrumentation**:
A capture source composed into the WebSDK: the only way the browser SDK captures anything. Built-ins are errors, pageviews, interactions, performance, and network; `sampled` wraps one to capture a fraction of Sessions. OTel's word for exactly this, though Everr's contract is deliberately a bare setup function, not OTel JS's class-shaped interface.
_Avoid_: plugin (former name), integration, capture source (informal)

**Analytics event**:
A browser interaction or page lifecycle moment captured as a Log with an event name (`everr.browser.page_view`, `everr.browser.interaction.rage_click`, and the like). Not a separate signal kind: analytics events are Logs.
_Avoid_: autocapture event, tracking event

**Session**:
One continuous visit, identified by a random `session.id`. In Cookieless mode it lives only in JS memory (a page load plus its SPA navigations); in Consented mode it persists with a 30-minute inactivity timeout. The top-level analytics unit.
_Avoid_: visit

**Visitor**:
A browser identified across Sessions by a random stored `visitor.id`. Exists only in Consented mode; Cookieless mode has no Visitor concept at all.
_Avoid_: person, device id, anonymous user

**Cookieless mode**:
The browser SDK mode with zero cookies, zero storage, and no identity derived from IP or user agent: only an in-memory Session. What the homepage runs.
_Avoid_: anonymous mode, bannerless mode

**Consented mode**:
The browser SDK mode entered after explicit consent: persistent Visitor id, durable Sessions, and identify() stamping `user.*` attributes on subsequent events. Upgrading from Cookieless is a one-way door; revoking consent deletes the stored ids.
_Avoid_: identified mode, cookie mode

### CI

**CI run**:
A single GitHub Actions workflow execution, captured as a Trace with status, timing, cost, and flakiness. (Stored as `workflow_runs`; "workflow run" is the schema-level name.)
_Avoid_: build, pipeline, run (on its own)

**Job**:
A unit within a CI run that executes on a Runner and contains an ordered sequence of Steps.

**Step**:
A single command or action within a Job.
_Avoid_: action

**Attempt**:
The retry iteration of a CI run or Job; the first execution is attempt 1.
_Avoid_: retry count

**Runner**:
The machine that executes a Job, such as `ubuntu-latest` or a self-hosted runner.
_Avoid_: machine, agent

**Flaky test**:
A test whose outcome varies for the same code — sometimes passing, sometimes failing.
_Avoid_: intermittent failure

### Resources as code

**Dashboard**:
A grid of Panels for visualizing telemetry, defined as code and reconciled with apply.

**Built-in dashboard**:
A Dashboard that ships with Everr: fully openable and live, but read-only and never materialized per-Organization. The counterpart to "Your dashboards" (user-defined ones). Creating something editable from a Built-in dashboard happens only by handing off to an Agent, never in the UI.
_Avoid_: template (former framing), preset, sample dashboard

**Panel**:
The configured unit within a Dashboard or Runbook — a query plus a chosen Visualization and its placement in the grid. The Panel is the config; the Visualization is how it draws.
_Avoid_: widget, chart (a chart is one Visualization kind, not the Panel)

**Visualization**:
The render kind a Panel uses to display its query result — TimeSeriesChart, BarChart, Table, StatChart, GaugeChart, and the like. Distinct from Panel: many Panels can share one Visualization kind, and switching a Panel's Visualization leaves the query intact.
_Avoid_: chart (one kind, not the category), viz (informal), panel type

**Runbook**:
A multi-page Markdown document with embedded Panels and shared variables — the umbrella concept for any such as-code document, whether used for incident response, an agent skill, or an investigation doc.
_Avoid_: Notebook (former name — renamed June 2026; see ADR 0002). Still accepted in config for back-compat: `kind: Notebook` ≡ `kind: Runbook` and `.notebook.yaml` is recognized, but `Runbook` is canonical everywhere new.

**Alert**:
A rule that runs a query on a schedule and notifies when it returns rows; an empty result means resolved.
_Avoid_: monitor

**Apply**:
The idempotent operation (`everr apply`) that reconciles the Dashboards, Alerts, and Runbooks in a directory to match their as-code definitions.
_Avoid_: deploy, sync, push

**Repoid**:
The stable identity that scopes ownership: every Dashboard, Alert, and Runbook is owned by exactly one Repoid, and apply only ever touches resources under it. Inferred from the repository's `origin` remote (normalized to the `host/owner/repo` slug) unless a Manifest pins one explicitly.
_Avoid_: repo id, ownership key

**Ownership boundary**:
The set of live resources sharing one Repoid — what apply reconciles a directory against, and prunes within. Adopt moves individual resources across boundaries.
_Avoid_: reconcile scope, prune boundary (informal, code-level)

**Manifest**:
The optional `everr.yaml` file that pins a directory's Repoid explicitly, overriding the one inferred from the `origin` remote. The escape hatch for repositories without a usable remote or that need a fixed identity.
_Avoid_: config file, everr.yaml (name the concept, not the filename)

**Adopt**:
Taking over resources another Repoid owns by re-applying them under yours (`everr apply --adopt`). Deliberately targeted: only the resources present in the applied tree change owner; everything else the other Repoid owns is left untouched.
_Avoid_: take over, claim

### Agent integration

**Agent**:
An AI coding assistant (Claude Code, Cursor, Codex, and the like) that integrates with Everr through Skills or the MCP server. A first-class consumer of Everr alongside the human User and at the same level: it reads and acts on the same telemetry, neither above nor below the User. Not the Collector. An Agent is also the target a Skill is installed for.
_Avoid_: assistant, bot, provider

**Skill**:
A bundled set of instructions that teaches an Agent how and when to use Everr.
_Avoid_: plugin, extension

**MCP server**:
Everr's surface for Agents to query telemetry over the Model Context Protocol, exposing read-only SQL and identity as tools. An MCP client is just an Agent connected to this surface — the protocol counterpart to a Skill, which instead teaches an Agent to use the CLI.
_Avoid_: MCP endpoint, tool server, MCP client (an Agent, named by how it connects)

**Wrap**:
Running a command through `everr wrap` so its stdout, stderr, and exit code are captured as Logs.

### Onboarding & authentication

**Onboarding**:
The first-run flow that takes a new User and Organization from sign-up to a usable state — naming the Organization, connecting GitHub, importing CI runs, installing Skills, and authorizing the CLI. The web wizard and the CLI's `everr setup` are its two surfaces.
_Avoid_: wizard, setup (a generic synonym; `everr setup` is the command name)

**Device authorization**:
How a client without a browser — the CLI or the desktop app — signs in: Everr shows a short Device code, the User approves it in the browser, and the client becomes authenticated for an Organization.
_Avoid_: device flow, device sign-in, login

**Device code**:
The short, human-readable code a client shows during Device authorization for the User to confirm in the browser.
_Avoid_: user code, OTP, token
