# Telemetry Documentation

Every setup handoff includes instructions for both the local collector and the selected remote installation, regardless of which destination was configured or validated. Document the actual implementation and clearly identify any work still needed to enable another destination.

## README

Create or update a **Telemetry** section in the README that owns the instrumented services. Use **Local collector** and **Remote installation / production** as subsections. Follow the repository's documentation layout: if detailed telemetry instructions already live elsewhere, update them and link them from the README. In a monorepo, identify the configuration for each instrumented service or runtime; share instructions only when they actually match.

Include:

- Services, captured signals, relevant code paths, and links to the instrumentation/configuration files.
- A configuration table with the exact variable or SDK setting, its purpose, local value, remote value, where it is set, and whether it is read at build time or runtime. Explain activation conditions, endpoint precedence, and behavior when settings are absent.
- Local startup and verification instructions, plus the production checklist below.
- Verification status by environment, separating observed ingestion from instructions for a future deployment.

Derive names from the installed setup. `OTEL_EXPORTER_OTLP_ENDPOINT`, `EVERR_INGEST_KEY`, and `VITE_EVERR_PUBLIC_INGEST_KEY` are common examples, not variables that every runtime automatically reads. If an SDK receives an option in code, document that option or the actual variable wired to it. Identify any missing exporter, authentication wiring, or environment gate that requires a code change before the alternate destination can work. Present such work as a prerequisite, not as an already supported environment-variable switch.

## Local collector

Show `everr local status`, and `everr local start -d --no-open` if the collector is stopped. Use the returned `otlp:` URL as the local exporter endpoint and the returned `ui:` URL to open the data. Explain where each runtime reads that endpoint. Use `<otlp-url-from-status>` in reusable examples so users obtain the correct URL for their machine.

State that local collection needs no ingest key. Include the application's actual start/restart command and explain how to exercise an instrumented path and verify fresh data with `everr local query`. Keep local endpoint values in local configuration.

## Production checklist

Read [Remote setup](remote-setup.md) for the credential model and key creation flow. Include these steps in the README, adapted to each runtime, and summarize them in the final response even after local-only validation:

1. **Obtain the appropriate API key.** Server exporters use a secret ingest key with **Send telemetry** capability. Direct browser exporters use a public key with the deployed origins in its allowlist. Explain where to create each applicable key and where it belongs in this project's configuration. CLI login authenticates queries; it does not supply the application's ingest key.
2. **Select the remote installation.** Document the saved project target and its discovered `ingestEndpoint`, and the exact endpoint/key variables or SDK options consumed by the implementation. Explain the endpoint and key settings that activate export. Document how to remove or replace a local endpoint override when it takes precedence, so an ingest key alone is not presented as sufficient in that case.
3. **Configure the deployment.** Name the server secret variables to set in the hosting environment or secret manager, and the public browser variables to set in the client build environment. Document the actual settings supplying `deployment.environment.name=production` and the deployed service version. Keep secret keys out of client configuration; examples contain placeholders, never key values.
4. **Activate the configuration.** State any remaining code prerequisites, then the applicable build, redeploy, or restart steps. Browser build-time values require rebuilding the client; describe the project's actual configuration lifecycle. Existing production exporters outside the task retain their configuration.
5. **Verify deployed ingestion.** Exercise a named instrumented path after deployment. Use `everr login` if query access is needed, select the same organization as the ingest key, and run `everr query` against fresh telemetry filtered by service, production environment, time window, and the marker when used. Link the discovered app `url` and name the filters to inspect. Keep production ingestion marked unverified until fresh query evidence exists.

Documenting this checklist does not require deploying, obtaining credentials, or querying production during a local-only task. If production is already configured, describe its actual settings and repeatable validation rather than proposing another exporter.

## Handoff check

Before the final response, verify that both destinations are explained in the README, every documented setting corresponds to implemented configuration or an explicit prerequisite, and the response includes the concrete production steps. A local success message and a link to general setup documentation alone do not complete the handoff.
