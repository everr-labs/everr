# Everr CLI

`pnpm --filter @everr/cli build:debug` builds the local UI, prepares the collector and chDB library, and embeds them in the CLI. `build:release` produces the release binary and checksum. The CLI version comes from this package's `package.json`.

`everr local start` serves the bundled UI and starts the collector until interrupted. `--no-open` suppresses browser launch; `--quiet` suppresses startup output and browser launch. `everr local status` reports collector endpoints and the UI URL when its server is running.

`everr setup` installs agent skills and shows how to start local telemetry. Use `/everr-onboard` in your coding agent to instrument a local app and verify its first real signal. Cloud sign-in and ingest keys are separate follow-up steps when you want hosted telemetry or CI.
