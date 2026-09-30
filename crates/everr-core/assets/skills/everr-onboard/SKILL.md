---
name: everr-onboard
description: Instrument a locally running app, send its first real telemetry to the Everr local collector, and verify it.
---

# First Local Signal

Use this skill for first-time Everr onboarding, including users arriving from the web signup flow. Complete onboarding with the app's own telemetry stored locally. Local collection works without Cloud sign-in or an ingest key.

1. Inspect the repository's runtime, existing OpenTelemetry setup, entry points, and local start command. Identify one real request, job, or interaction to instrument. Read `../everr-setup-telemetry/rules/resolve-values.md`, plus `resources.md`, `sensitive-data.md`, `validation.md`, and the matching runtime and signal rules in that directory.
2. Run `everr local status`. If the collector is stopped, start `everr local start --no-open` in a separate terminal or persistent command session and keep it alive. This command stays in the foreground. Read the `otlp:` and `ui:` URLs from status or start output rather than guessing ports.
3. Add the smallest useful instrumentation for the chosen path, following the setup rules. Export over OTLP/HTTP to the returned `otlp:` URL without an auth header. Scope this setup to development and test runs, preserving existing deployed telemetry configuration. For browser apps, follow `../everr-setup-telemetry/rules/browser.md` using its local collector path.
4. Run the project's build or typecheck, start the app locally, and exercise the instrumented path. Reuse a running app when it already has the instrumentation. If app startup requires user action, give the exact command and keep verification pending.
5. Run `everr local query` for fresh rows with the expected `ServiceName`, filtered by a request or run marker when practical. Follow the query and signal checks in `../everr-setup-telemetry/rules/validation.md`. Onboarding succeeds only when the build passes and fresh telemetry proves the exercised path reached the local collector.
6. Report the observed signal and the action that produced it. Give the user the returned `ui:` URL to inspect it in Logs, Traces, or Errors. Keep Cloud setup as a separate follow-up when the user wants it.
