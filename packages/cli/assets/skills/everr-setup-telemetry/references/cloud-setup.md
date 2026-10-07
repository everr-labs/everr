# Cloud Setup

Read this when the selected destination is Everr Cloud, whether the app runs in development, test, or production. Configure only the requested environments; a cloud destination does not imply a production rollout.

## Credentials and query access

Application ingest and CLI queries use separate credentials:

- Check CLI access with `everr cloud query "SHOW TABLES"`. If the session is missing or expired, use `everr cloud login` and select the intended organization, then retry the query.
- Use an application ingest key belonging to that same organization. CLI login does not configure the application's exporter, and an ingest key does not grant CLI query access.

Use these hosted ingest settings:

- Endpoint: `https://ingest.everr.dev/`
- Header: `Authorization: Bearer <ingest-key>`
- Server-side secret environment variable: `EVERR_INGEST_KEY`
- Service identity: a stable `service.name` hardcoded in the setup module for each service

For server-side export, load the key from the secret manager or the local environment when testing cloud export. If no key exists, guide the user to the Everr dashboard's user menu, **API keys**, and have them store it in the appropriate secret store. Do not invent, print, hardcode, or commit keys.

Browser export uses a public origin-bound ingest key instead of a server-side secret. Follow [Browser instrumentation](../rules/browser.md#key-model), including the development origin when testing cloud export locally.

## Configure the selected environment

- Use `https://ingest.everr.dev/` for the environments selected for cloud export. Preserve other environments' existing destinations.
- Enable hosted export only when the appropriate server-side or public browser ingest key is present.
- Keep `deployment.environment.name` tied to the app's actual environment, including development or test runs sent to cloud.
- Keep secrets, tokens, emails, request bodies, and raw customer payloads out of attributes and log bodies.
- Keep `EVERR_INGEST_KEY` out of browser bundles.
- Preserve normal crash and shutdown behavior while flushing telemetry.

## Production, only when requested

Store server-side keys in the deployment secret manager and inject public browser keys through the client build configuration. Populate release and environment metadata from the deployment. Keep production telemetry lower-noise than local debug telemetry. Production credentials or deployment changes are not prerequisites for a local-only task.

## Validate and report

Exercise the instrumented path in the selected environment and follow [Validation](../rules/validation.md) using `everr cloud query`. Filter by the service, environment, recent time window, and a unique marker when available. No local collector or local query is needed.

Report the environment and query evidence that were actually verified. A build or a development run sent to cloud does not prove production ingestion. If the deployed path cannot be exercised yet, report production configuration as prepared and specify the remaining deployment or access step.
