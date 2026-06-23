# Everr

Software delivery intelligence for developers and AI agents: the same OpenTelemetry data — local, CI, and production — exposed behind a read-only SQL surface. This glossary fixes the canonical word for each domain concept so code, docs, and conversation stay aligned.

## Language

### Tenancy & access

**Organization**:
The top-level account that owns telemetry, dashboards, alerts, notebooks, members, and API keys. The unit of billing and access control.
_Avoid_: workspace, account, tenant (see Tenant)

**Tenant**:
The data-isolation dimension that keeps one Organization's telemetry separate from another's. Conceptually one-to-one with Organization, but named separately because isolation is enforced along this axis.
_Avoid_: using Tenant as a plain synonym for Organization

**Project**:
A namespace within an Organization for dashboards, alerts, and notebooks, so different teams can reuse the same name without colliding. Defaults to `default`.
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

**Panel**:
A single visualization — chart, table, stat, gauge — within a Dashboard or Notebook, backed by a query.
_Avoid_: widget, chart, visualization (a chart is one kind of Panel; the Panel is the config)

**Notebook**:
A multi-page Markdown document with embedded Panels and shared variables.

**Alert**:
A rule that runs a query on a schedule and notifies when it returns rows; an empty result means resolved.
_Avoid_: monitor

**Apply**:
The idempotent operation (`everr apply`) that reconciles the Dashboards, Alerts, and Notebooks in a directory to match their as-code definitions.
_Avoid_: deploy, sync, push

**Repoid**:
The stable identifier declared in the Manifest that defines which resources a repository owns and may reconcile with apply.
_Avoid_: repo id, ownership key

**Manifest**:
The `everr.yaml` file that declares a directory's Repoid (its ownership boundary).

### Agent integration

**Agent**:
An AI coding assistant — Claude Code, Cursor, Codex, and the like — that consumes Everr Skills. Not the Collector.
_Avoid_: assistant, bot

**Skill**:
A bundled set of instructions that teaches an Agent how and when to use Everr.
_Avoid_: plugin, extension

**Wrap**:
Running a command through `everr wrap` so its stdout, stderr, and exit code are captured as Logs.
