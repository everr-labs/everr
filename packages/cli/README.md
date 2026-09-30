# Everr CLI

`pnpm --filter @everr/cli build:debug` builds the local UI, prepares the collector and chDB library, and embeds them in the CLI. `build:release` produces the release binary and checksum. The CLI version comes from this package's `package.json`.

`everr local start` serves the bundled UI and starts the collector until interrupted. Successful startup prints only the OTLP, SQL, and UI addresses; detached startup also prints the log path. `--no-open` suppresses browser launch; `--quiet` suppresses startup output and browser launch. If the collector and UI are already ready and share an instance ID, another `local start` prints the endpoints and exits successfully. Partial instances or occupied ports cause an error; startup never stops existing listeners.

`everr local start -d` (or `--detach`) runs the same supervisor in the background and returns once the collector and UI are ready. It survives closing the terminal. A lock prevents two instances from opening the same telemetry data directory.

Detached supervisor and collector output goes to `~/Library/Logs/everr/local.log` on macOS or `$XDG_STATE_HOME/everr/local.log` on Linux (default `~/.local/state/everr/local.log`). Debug builds use `everr-dev` instead of `everr` in the directory name. `EVERR_LOCAL_LOG_DIR` overrides the log directory, and startup prints the full path. Logs rotate while running at 5 MiB per file, keeping three backups (`local.log.1` through `local.log.3`), for at most 20 MiB total. New log directories and files are private to the user. Separate instances need separate log directories. Existing logs in the telemetry directory are left untouched. Application telemetry remains in the collector's chDB store, independently of these diagnostic logs.

`everr local stop` requests graceful shutdown of the recognized local instance and waits for the collector and UI to stop. It works for foreground and detached instances and succeeds when already stopped. Telemetry data is kept. Detached mode does not start at boot or automatically restart a crashed supervisor.

`everr local status` checks both `/health` responses for the expected service, protocol, version, readiness, and instance ID. It distinguishes running, starting, stopped, unrecognized listeners, and connection failures, and exits with code 2 unless the collector and UI are a matching ready instance.

`everr setup` installs agent skills and shows how to start local telemetry. Cloud sign-in and ingest keys are separate follow-up steps when you want hosted telemetry or CI.
