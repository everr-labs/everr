---
name: everr-setup-telemetry
description: Set up, extend, or repair OpenTelemetry instrumentation and export to Everr. Use for missing or duplicate signals, exporter failures, or temporary debug instrumentation. For investigating application behavior with existing telemetry, use everr-use-telemetry.
---

# Setup Telemetry with Everr

## Core methodology

Instrument the codebase keeping the user as decision-maker of the instrumentation choices: what services to instrument, what signals to use, etc. You are the observability expert, guiding the user to make the best choices for their codebase.
Use the Everr CLI to validate and debug instrumentation against the selected destination: the local collector or Everr Cloud. Configure only the environments requested by the user. Cloud is a telemetry destination, not an environment: development telemetry sent to cloud still has a development environment.
If the user wants to setup alerting rules on that telemetry (and dashboards or runbooks), use the `everr-setup-resources` skill.

## Default Workflow
### Step 0 - Select the destination and check prerequisites

1. Honor the requested destination. Default development and test work to the local collector; use Everr Cloud for requested production setup or an explicit cloud choice. If both environments are requested, configure and validate each separately.
2. Ensure the `everr` CLI is installed and accessible.
3. For local export, run `everr local status`. If stopped, run `everr local start -d --no-open` and check status again. Use the returned `otlp:` and `ui:` URLs. If the collector cannot start, resolve the reported problem or ask the user whether to repair it or switch to cloud. Switch only when the user has chosen cloud.
4. For cloud export, follow [Cloud setup](references/cloud-setup.md) for ingest credentials and CLI query access. A local collector is not required for this branch.


### Step 1 - Plan the instrumentation

1. Inspect the services, frameworks, development and production runtimes, and existing OTel setup. Use the request and repository inspection to establish the target services, signals, code paths, environments, and destination.
2. Reuse decisions already provided by the user. Ask only about unresolved choices that materially change scope or behavior.
3. For an unspecified initial setup, recommend a minimal configuration supported by the runtime and explain the choices the user needs to make.
4. Present a concise plan identifying the services, signals, code paths, environments, destination, and validation approach. Proceed when the requested scope is clear. Wait for an answer only when an unresolved decision blocks the work.


### Step 2 - Instrument the codebase

#### Choose the instrumentation path

Classify each targeted service and signal after inspecting the existing setup:

- **New setup:** No instrumentation setup exists in the targeted runtime. Add the smallest setup supported by the runtime for the requested signals.
- **Extend:** A working setup exists, even if the requested signal is new. Reuse its providers, exporters, and startup hooks where applicable; add only the missing instrumentation or signal.
- **Repair:** Expected telemetry is missing, incorrect, or duplicated. Reproduce the symptom and locate the failing stage: emission, processing/sampling, export, ingestion, or query selection. Make the smallest correction supported by that evidence and complete the [Repair validation gate](rules/validation.md#repair-validation-gate).

Preserve working signals and existing destinations outside the task. Add another provider or exporter only when the requested signal or runtime requires it, and explain why the existing pipeline cannot serve that signal.

#### Apply and validate

1. Read the guidance selected by the table below before editing instrumentation. Resolve the required service identity, environment, endpoint, and authentication values before applying the plan.
2. Apply the plan for the selected services, signals, environments, and destination. Adapt runtime examples to that scope; their production configuration is conditional on a production request.
3. Gate local-only exporters so local collector URLs do not ship in production bundles. For a local-only task, preserve existing production export configuration and do not add hosted ingest or require production credentials. For cloud export, follow [Cloud setup](references/cloud-setup.md).
4. Exercise the instrumented path and complete [Validation](rules/validation.md) against the selected destination. Use `everr local query` for local export and `everr cloud query` for cloud export.
5. Run the project's production build (or its typecheck when no build exists). Dev servers skip strict type checking, so telemetry that flows in dev can still break the build. Running this check does not require configuring or deploying production telemetry.
6. Claim success only for environments where fresh query results prove ingestion from the exercised path and the build check passes. If deployment or credentials are unavailable, report the configuration as prepared and identify the remaining validation.

#### Select guidance

Read the rules matching the change. Use the contents links in long references to reach the relevant sections; signal-specific examples apply only to signals in the plan.

| When | Read |
| --- | --- |
| Resolving or changing service identity, environment, endpoint, or authentication | [Resolve configuration values](rules/resolve-values.md) |
| Adding or changing service resource attributes | [Resources](rules/resources.md) |
| Adding or changing captured data or redaction | [Sensitive data](rules/sensitive-data.md) |
| Adding or changing spans, context propagation, or span status | [Spans](rules/spans.md) |
| Adding or changing structured logs or trace correlation | [Logs](rules/logs.md) |
| Adding or changing metric instruments, units, or attributes | [Metrics](rules/metrics.md) |
| Capturing errors without an `@everr` SDK, for example in Python, Go, or Java | [Error tracking](rules/error-tracking.md) |
| Setting up a generic Node.js service, CLI, worker, or test runner; framework-specific rules take precedence | [Node.js](rules/nodejs.md) |
| Instrumenting Next.js App Router on the Node.js runtime | [Next.js](rules/nextjs.md) |
| Instrumenting a browser app that is not wrapped in Electron or Tauri | [Browser](rules/browser.md) |
| Wiring a Vite SSR app on Node.js | [Vite SSR](rules/vite-ssr.md), plus Node.js and Browser for the halves being changed |
| Joining browser and server traces, including in Next.js | [Browser/server trace joining](rules/vite-ssr.md#the-seam-joining-browser-and-server-traces) |
| Instrumenting TanStack Start | [TanStack Start](rules/tanstack-start.md), plus Vite SSR and the rules for the halves being changed |
| Instrumenting Next.js Server Actions, TanStack Start server functions, or equivalent framework functions | [Server functions](rules/server-functions.md), alongside the framework and Spans rules |
| Instrumenting Tauri v2 with Rust and a frontend using IPC | [Tauri](rules/tauri.md), plus Rust for backend instrumentation |
| Instrumenting Electron main and renderer processes using IPC | [Electron](rules/electron.md), plus Node.js for main-process instrumentation |
| Instrumenting a Rust service or backend | [Rust](rules/rust.md) |
| Exporting to Everr Cloud in any requested environment | [Cloud setup](references/cloud-setup.md) |
| Verifying any instrumentation change | [Validation](rules/validation.md) |

#### Instrumentation rules

OpenTelemetry clients can export directly to the local collector. No wrapper is needed for instrumented apps.

For a new setup, or the missing pieces of an extension:

- Add any missing SDK or OTLP/HTTP exporter components and ensure a clear `service.name`.
- Check for official or community auto-instrumentation that matches the runtime and libraries before writing custom instrumentation.
- Load instrumentation before importing HTTP, database, queue, or framework modules.
- Add spans around entry points and I/O boundaries when auto-instrumentation is not enough.
- Capture errors as structured telemetry, not only terminal output.
- Redact secrets, tokens, emails, request bodies, auth headers, cookies, and raw customer payloads before export.
- Prefer instrumenting the app's existing structured logger or adding targeted OTel logs at important boundaries. Do not monkey-patch `console.*` or mirror all console output into telemetry unless it is temporary, development-gated, redacted, and bounded to the specific path being verified.

### Step 3 - Summarize the setup and guide the next use

Write the final response in the user's language. Lead with the outcome: what they can now observe in Everr, or what is prepared but still awaits validation. Keep the handoff concise, with three parts:

#### What changed

- Name the services, signals, and code paths added or repaired, and explain what they help the user understand, such as request latency, failed jobs, or frontend errors.
- State the destination and environment for each setup. Link the main configuration or instrumentation files and explain how export is enabled, including any required environment variable names, without exposing credentials.
- For repairs, identify the cause and correction. For temporary debug instrumentation, state its activation and removal conditions.

#### What was verified

- Summarize fresh query evidence from the exercised path: service, environment, time window, correlation marker when used, and a representative result such as a span, log, metric, or trace ID. Include the build or typecheck command and result. Use compact evidence rather than a transcript of every query.
- Label each requested environment as verified or still awaiting validation. Explain any missing prerequisite and avoid implying that a successful local run proves cloud or production ingestion.

#### What's next

Prioritize a few concrete actions based on this setup:

1. **Finish any pending activation or validation.** If a restart, credential, or deployment is still needed, state the exact next action and how ingestion will be checked afterward. Use commands and configuration names established during the task. When setup is verified, start directly with exploring the data.
2. **Open the data in Everr.** Link the relevant signal pages and tell the user which service, environment, and time range to select and what to look for from the exercised path. For local export, use the `ui:` base URL returned by `everr local status` with `/traces?from=now-1d&to=now`, `/metrics?from=now-1d&to=now`, or `/logs?from=now-1d&to=now`, including only the relevant signals. For cloud export, use [Everr Cloud](https://app.everr.dev/) or a verified telemetry page URL for the selected organization. Use verified filter URL syntax or describe the filters in text.
3. **Use the telemetry to answer a real question.** Give one or two ready-to-send prompts tailored to the instrumented service, environment, destination, and available signals. Introduce them as things the user can ask their agent next with `everr-use-telemetry`. For example, adapt "Use Everr local telemetry to explain which spans made the latest checkout request in checkout-api slow" or "Use Everr Cloud to investigate recent production errors in checkout-api and correlate their logs with traces." Resolve example names to the actual setup and suggest only investigations supported by its telemetry.

When ongoing monitoring fits the user's goal and cloud telemetry is available, suggest a specific dashboard, alert, or runbook as an optional follow-up with `everr-setup-resources`. Tie it to a useful question and an observed signal. Present follow-ups as suggestions; execute them only when they are already part of the requested scope.

## Command Choice

| Need | Command |
| --- | --- |
| Check collector state | `everr local status` |
| Start the CLI collector | `everr local start` |
| Get the local OTLP/HTTP endpoint | `everr local status` |
| Verify local telemetry arrived | `everr local query "<SQL>"` |
| Authenticate cloud query access when needed | `everr cloud login` |
| Verify cloud telemetry arrived | `everr cloud query "<SQL>"` |
| Capture build/lint output | `everr wrap -- <command>` |

For local export, keep the endpoint as `<otlp-url-from-status>` in plans and example commands until you have actual status output.

Both query commands accept ClickHouse-style SQL. Query the store receiving the telemetry.

## Debug Telemetry

Use debug telemetry when normal telemetry does not explain local behavior yet.

- Emit it at debug level or behind a development flag.
- Include concrete attributes: route, command, job id, test name, feature, user-safe identifiers, branch, commit, and correlation ids when available.
- Prefer one useful log or span at each boundary over many noisy messages inside loops.
- Remove or gate anything that should not be present in production.

Do not optimize local debug telemetry for storage cost. Rich local evidence is usually cheaper than another round of guessing.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Naming a likely collector URL such as a default localhost port before reading status | Use `<otlp-url-from-status>` in plans and examples until `everr local status` returns the actual endpoint. |
| Adding a run, request, or test marker but querying only by service and time | Filter the query by the marker too, or do not claim the marker proved freshness. |
| Mirroring every `console.*` call into logs | Prefer targeted OTel logs or the app's structured logger; any bridge must be temporary, gated, redacted, and bounded. |
| Verifying by UI visibility or absence of exporter errors | Query the selected destination with `everr local query` or `everr cloud query` and show rows from the exercised path. |
| Validating only against the dev server | Run the production build too; strict type checking is skipped in dev, and OTLP exporter `headers` options are a common casualty (a conditional headers value uses `undefined` for the keyless branch, never `{}`). |
| Exposing `EVERR_INGEST_KEY` to the browser | Browsers use a public origin-bound ingest key (`rules/browser.md`); secret keys stay server-side. |
