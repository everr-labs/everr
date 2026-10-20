# Everr CLI

## Installations and sessions

Run `everr cloud login` to authenticate with Everr Cloud. For self-hosted installations,
supply the app URL:

```sh
everr cloud login --url https://observability.acme.com
everr cloud status --json
everr cloud logout
```

Approve the login in your browser and select an organization. The onboarding page
copies a command with the installation URL. Use `--no-open` to print the
authorization URL without opening a browser.

The CLI saves one session containing the API URL and token. A successful login
replaces it; failed logins preserve the previous session. Without `--url`, login
reuses the saved URL or the build's default when no session exists. Login does not
create or read repository target configuration. To switch installations or
accounts, authenticate again with `everr cloud login`. Remote queries use
`everr cloud query`, including self-hosted installations.

Sessions live in `session.json` under the platform's user configuration directory:
`~/Library/Application Support/everr` on macOS, or
`${XDG_CONFIG_HOME:-~/.config}/everr` on Linux. Debug builds use `session-dev.json`
and default to `http://localhost:5173`; releases default to `https://app.everr.dev`.
Session files are private to the user. `EVERR_CONFIG_DIR` overrides the directory
with an absolute path. Existing session files remain readable.

Use `everr cloud status` to check the installation, account, organization, and
ingestion endpoint. `--json` returns `url`, account and organization identity, and
`ingestEndpoint` from the server. Cloud advertises its hosted ingest
endpoint; self-hosted installations advertise `EVERR_PUBLIC_INGEST_URL`. A null
endpoint means it is unconfigured or unavailable on an older server. The ingestion
endpoint is not stored in the session file. Save it in the application's exporter
configuration and document the settings under Telemetry. App and ingestion URLs
can differ. Ordinary queries use the saved session directly.

For unattended `apply`, set `EVERR_API_KEY` (or the deprecated `EVERR_API_TOKEN`)
and `EVERR_API_URL`. With a key, an omitted URL falls back to the saved session's
URL. Other remote commands use the saved session. Exporters use separate ingestion
keys rather than the CLI session token.

Local commands and the local UI operate independently of remote login. They read
neither the session file nor repository target configuration. The local UI manages
local telemetry without remote account or sign-in controls.

## Development

`pnpm --filter @everr/cli build:debug` builds the local UI, prepares the collector and chDB library, and embeds them in the CLI. `build:release` produces the release binary and checksum. The CLI version comes from this package's `package.json`.

`everr local start` serves the bundled UI and starts the collector until interrupted. Successful startup prints the Everr banner in a terminal and the OTLP, SQL, and UI addresses; detached startup also prints the log path. Redirected output omits the banner. `--no-open` suppresses browser launch; `--quiet` suppresses startup output and browser launch. If the collector and UI are already ready and share an instance ID, another `local start` prints the endpoints and exits successfully. Partial instances or occupied ports cause an error; startup never stops existing listeners.

`everr local start -d` (or `--detach`) runs the same supervisor in the background and returns once the collector and UI are ready. It survives closing the terminal. A lock prevents two instances from opening the same telemetry data directory.

Detached supervisor and collector output goes to `~/Library/Logs/everr/local.log` on macOS or `$XDG_STATE_HOME/everr/local.log` on Linux (default `~/.local/state/everr/local.log`). Debug builds use `everr-dev` instead of `everr` in the directory name. `EVERR_LOCAL_LOG_DIR` overrides the log directory, and startup prints the full path. Logs rotate while running at 5 MiB per file, keeping three backups (`local.log.1` through `local.log.3`), for at most 20 MiB total. New log directories and files are private to the user. Separate instances need separate log directories. Existing logs in the telemetry directory are left untouched. Application telemetry remains in the collector's chDB store, independently of these diagnostic logs.

`everr local stop` requests graceful shutdown of the recognized local instance and waits for the collector and UI to stop, telemetry to flush, and the supervisor's data and log locks to be released. A successful stop can be followed immediately by another start. It works for foreground and detached instances and succeeds when already stopped, waiting for any cleanup still in progress. Telemetry data is kept. Detached mode does not start at boot or automatically restart a crashed supervisor.

`everr local status` checks both `/health` responses for the expected service, protocol, version, readiness, and instance ID. It prints the same OTLP, SQL, and UI rows as startup, showing a URL for a running service or its state in place of the URL otherwise. It distinguishes starting, stopped, unrecognized listeners, and connection failures, warns about mismatched instances, and exits with code 2 unless the collector and UI are a matching ready instance.

`everr local ui` opens the configured local UI URL in your default browser and prints `ui: <url>`. It requires the same matching ready instance as `local status`. Otherwise, it reports the same diagnostics and exits with code 2, without starting services. If browser launch fails, it exits with code 1 and prints the URL to open manually.

`everr cloud status` checks the saved session with its installation and prints the current user's name, email, organization, installation URL, and ingestion endpoint as `Name:`, `Email:`, `Organization:`, `Installation:`, and `Ingestion endpoint:` rows. `--json` returns these connection details as JSON. Missing or expired sessions and request failures produce an error without changing the saved session. The command does not print the session token.

Install bundled agent skills for your project with `everr skills install --all --project`. Start local telemetry with `everr local start`. Installation sign-in and ingest keys are separate follow-up steps when you want remote telemetry or CI.

## Telemetry

Everr's internal product telemetry (`everr-cli` and `everr-local-ui`) uses a separate configuration from the applications you observe. Application telemetry and `everr wrap` output continue to go to your local collector. Configuring `EVERR_INGEST_KEY` or `OTEL_EXPORTER_OTLP_*` for your applications never redirects Everr's internal telemetry or supplies its authentication headers.

Debug builds send internal telemetry to the development collector. Run `everr-dev local start` and use the `otlp:` URL from `everr-dev local status`. For an alternate debug destination, set `EVERR_INTERNAL_TELEMETRY_ENDPOINT` to an OTLP/HTTP base URL. This override is ignored by release builds. CLI and UI versions and deployment environments come from the Rust build, including when a production Vite bundle is embedded in a debug CLI.

Release builds send internal telemetry only to `https://ingest.everr.dev`, authenticated by `EVERR_INTERNAL_TELEMETRY_INGEST_KEY` supplied when compiling the binary. Create an origin-bound public key in the Everr Labs organization with the allowed origins `https://cli.everr.local` and `https://ui.everr.local` and only `ingest/write` permission. The CLI exporter sends `Origin: https://cli.everr.local`, and the UI proxy sends `Origin: https://ui.everr.local` so the existing public-key verification accepts these native requests. It is extractable from distributed binaries, grants no read or resource-management access, and is never returned to the browser. The origin is a compatibility requirement for the public ingest policy, not a proof of which native client sent a request. Runtime environment variables cannot replace it. Personal release builds without this key disable internal telemetry entirely.

For official releases, configure the GitHub Actions secret `EVERR_INTERNAL_TELEMETRY_INGEST_KEY`. The release workflow sets `EVERR_REQUIRE_INTERNAL_TELEMETRY=1` and refuses to build or publish without it. The existing `EVERR_INGEST_KEY` used by build-script telemetry remains separate and is not passed to the Rust compiler. Rotating the product key requires rebuilding and distributing a new release.

Export is best effort, uses a 750 ms request timeout, and does not follow redirects. Missing credentials, authentication errors, or cloud outages never fall back to the user's collector. The local UI's proxy discards events with `204` when internal telemetry is disabled. Release command-failure events use the fixed message `CLI command failed`; full errors stay in the terminal and local diagnostic output.

To validate a release, exercise a CLI command and a UI interaction, then use `everr cloud query` in the internal organization to find fresh rows for both service names and `deployment.environment.name = production`. Compare the command's trace id or the UI's unique test-error marker. Query the user's local store with `everr local query` over the same interval to confirm that neither internal service emitted there, while an application marker or wrapped command output still arrived. Updating Everr prevents new contamination; existing local records are retained.
