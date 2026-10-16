# Remote Setup

Use this for setup or connection troubleshooting with Everr Cloud or a self-hosted installation. The destination is independent of the application environment: development, test, and production can use the same installation.

## Resolve the connection once during setup

1. Run `everr whoami --json` from the repository. The CLI resolves `--profile`, `EVERR_PROFILE`, `.everr/config.yaml`, then the global default. Confirm the returned `url` and `organizationId` match the requested destination.
2. If authentication is missing or expired, follow the CLI's profile-specific login hint. For first setup, copy the login command from the installation's onboarding page, or run `everr login --url <app-url> --organization-id <organization-id>`. Choose `--profile <alias>` when an explicit separate profile is needed. Successful login creates the project target only when absent; it preserves existing project configuration.
3. Use the returned `ingestEndpoint` as the exporter's OTLP/HTTP base URL. If it is null, ask the installation administrator to configure `EVERR_PUBLIC_INGEST_URL`, or update an older server that does not advertise it. Resolve this before configuring remote export. The app URL and ingestion endpoint can have different hosts or ports.
4. Save the resolved endpoint in the application's configuration and document it under **Telemetry**. Keep secret key values in a secret manager or ignored local environment file. Commit the public project target so teammates and future agent sessions use the same installation.

Later agent sessions reuse the project target, login credentials, exporter configuration, and telemetry documentation. Ordinary `everr query` commands need no discovery preflight. Repeat discovery when setting up another destination, troubleshooting a connection, or refreshing an endpoint that the operator changed.

For a local-only task, document remote activation using the saved project context and explicit deployment variables. Remote authentication or deployment is needed when actually configuring or validating remote export.

## Application credentials

CLI login authenticates management and queries. Exporters use a dedicated ingestion key belonging to the same organization:

- Server: secret key with **Send telemetry** capability, conventionally loaded from `EVERR_INGEST_KEY` in the secret manager or ignored local environment.
- Browser: public origin-bound key created with **New public key**, conventionally injected through `VITE_EVERR_PUBLIC_INGEST_KEY` or the framework's actual client variable. Include every origin used in the selected environments.
- Both attach `Authorization: Bearer <ingest-key>` to the discovered endpoint. Keep server keys out of browser bundles and keys out of logs, tool output, and committed files.

Create keys in the selected installation's `/api-keys` page when needed. Read [Browser instrumentation](../rules/browser.md#key-model) for browser origins and key restrictions.

## Configure and verify

Configure only requested environments and preserve other destinations. Set the discovered endpoint explicitly, using `OTEL_EXPORTER_OTLP_ENDPOINT` where the implementation reads it, and configure the matching ingestion key. A key by itself does not select an endpoint. Preserve the application's service, release, and environment identity and normal crash/shutdown behavior.

Exercise a named instrumented path and follow [Validation](../rules/validation.md) with `everr query`. Filter by service, environment, recent time window, and marker when available. Open results under the discovered app `url` and selected organization. Keep production ingestion marked unverified until the deployed path produces fresh query evidence.

Document the actual exporter settings, secret references, build/restart steps, and validation in the README following [Telemetry documentation](telemetry-documentation.md). Summarize activation steps in the final response, including when only local setup was requested.
