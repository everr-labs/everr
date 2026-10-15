# Everr CLI

## Installations, organizations, and profiles

Run `everr login` from a repository to authenticate and configure its target.
For a self-hosted installation, supply its app URL:

```sh
everr login --profile acme --url https://observability.acme.com
```

The onboarding page copies a login command with both `--url` and
`--organization-id`. The organization flag pins device approval to that workspace,
including before a project file exists. It must agree with an existing target.

Approve the device in your browser and choose the organization to use. An existing
profile must be authorized with the same account and organization. Use
`--no-open` to print the authorization URL without opening a browser.

After successful authentication, login creates `.everr/config.yaml` at the Git
repository root if no project configuration exists. This file contains the
installation URL and organization ID, so it can be committed and shared:

```yaml
version: 1
url: https://observability.acme.com
organizationId: org_123
```

Login reads an existing file to select the installation and expected organization.
It never overwrites project configuration. Without a repository, login saves only
the global profile. Configuration lookup walks from the current directory up to
the nearest Git repository root, including worktrees. The nearest project file
wins, and lookup does not cross the repository root.

Profiles name an installation, organization, and account. Several profiles can
connect to different organizations on one installation, or to different
installations. Inspect or select them with:

```sh
everr profiles list
everr profiles show acme
everr profiles use acme
everr whoami
everr --profile staging resources list
everr logout --profile staging
everr profiles remove staging
```

Selection order is `--profile`, `EVERR_PROFILE`, project configuration, then the
global current profile. A project matches profiles by URL and organization ID,
independently of their aliases. Multiple matches require an explicit profile.
Missing, logged-out, or expired credentials produce an error for that target.
`whoami` shows the effective target and selection source. Local telemetry commands
continue to query the local collector. The local UI shares profile credentials
with terminal commands; `everr local start --profile acme` selects its remote
connection, including when started with `--detach`.

During exporter setup or connection troubleshooting, run `everr whoami --json`.
It returns the effective `profile`, `selectionSource`, `url`, account and
organization identity, and the server's `ingestEndpoint`, without credentials.
Cloud advertises its hosted ingest endpoint; self-hosted installations advertise
`EVERR_PUBLIC_INGEST_URL`. A null endpoint means it is unconfigured or the server
needs an update before it can advertise one. App and ingestion URLs can differ.

Save the discovered endpoint in your application's exporter configuration and
document the settings under Telemetry. Query commands reuse the saved project
target and credentials across terminal and agent sessions. Discovery is needed
for setup, endpoint changes, or troubleshooting, rather than before every query.

The first saved profile becomes the global default. `profiles use` changes that
default. Logout revokes only the selected session and retains the profile's
connection settings. Removing a profile deletes its saved settings and credentials.
The existing `everr cloud login`, `cloud logout`, and `cloud query` commands remain
available; `everr login`, `logout`, and `query` also work with self-hosted targets.

Global configuration lives in the platform's user configuration directory under
`everr`: `~/Library/Application Support/everr` on macOS, or
`${XDG_CONFIG_HOME:-~/.config}/everr` on Linux. `config.yaml` contains profiles and
the default selection; `credentials.json` contains session credentials. Debug builds
use `config-dev.yaml` and `credentials-dev.json`. Credential files are private to
the user. `EVERR_CONFIG_DIR` can override this directory with an absolute path.
Existing sessions are migrated to a `default` profile after fetching their account
and organization identity from the server, then the legacy session file is
removed. Profiles require an updated server
that returns those IDs and checks the expected organization on requests.

For unattended `apply`, `EVERR_API_KEY` (or the deprecated `EVERR_API_TOKEN`) can
authenticate using the configured target or an explicit `EVERR_API_URL`. An
explicit URL must agree with an explicitly selected profile or project target.
The server rejects a key or session belonging to a different organization before
executing resource changes. Ingestion keys and their destinations remain separate
from CLI login profiles.

## Development

`pnpm --filter @everr/cli build:debug` builds the local UI, prepares the collector and chDB library, and embeds them in the CLI. `build:release` produces the release binary and checksum. The CLI version comes from this package's `package.json`.

`everr local start` serves the bundled UI and starts the collector until interrupted. Successful startup prints the Everr banner in a terminal and the OTLP, SQL, and UI addresses; detached startup also prints the log path. Redirected output omits the banner. `--no-open` suppresses browser launch; `--quiet` suppresses startup output and browser launch. If the collector and UI are already ready and share an instance ID, another `local start` prints the endpoints and exits successfully. Partial instances or occupied ports cause an error; startup never stops existing listeners.

`everr local start -d` (or `--detach`) runs the same supervisor in the background and returns once the collector and UI are ready. It survives closing the terminal. A lock prevents two instances from opening the same telemetry data directory.

Detached supervisor and collector output goes to `~/Library/Logs/everr/local.log` on macOS or `$XDG_STATE_HOME/everr/local.log` on Linux (default `~/.local/state/everr/local.log`). Debug builds use `everr-dev` instead of `everr` in the directory name. `EVERR_LOCAL_LOG_DIR` overrides the log directory, and startup prints the full path. Logs rotate while running at 5 MiB per file, keeping three backups (`local.log.1` through `local.log.3`), for at most 20 MiB total. New log directories and files are private to the user. Separate instances need separate log directories. Existing logs in the telemetry directory are left untouched. Application telemetry remains in the collector's chDB store, independently of these diagnostic logs.

`everr local stop` requests graceful shutdown of the recognized local instance and waits for the collector and UI to stop, telemetry to flush, and the supervisor's data and log locks to be released. A successful stop can be followed immediately by another start. It works for foreground and detached instances and succeeds when already stopped, waiting for any cleanup still in progress. Telemetry data is kept. Detached mode does not start at boot or automatically restart a crashed supervisor.

`everr local status` checks both `/health` responses for the expected service, protocol, version, readiness, and instance ID. It prints the same OTLP, SQL, and UI rows as startup, showing a URL for a running service or its state in place of the URL otherwise. It distinguishes starting, stopped, unrecognized listeners, and connection failures, warns about mismatched instances, and exits with code 2 unless the collector and UI are a matching ready instance.

Install bundled agent skills for your project with `everr skills install --all --project`. Start local telemetry with `everr local start`. Installation sign-in and ingest keys are separate follow-up steps when you want remote telemetry or CI.
