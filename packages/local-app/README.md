# Everr Local

Vite and TanStack Router browser UI for the local telemetry collector. The CLI embeds the static build and serves it on loopback.

Run `pnpm dev:local` from the repository root. It prepares embedded assets on the first run, builds and starts the Rust CLI and collector, and opens the Vite UI at `http://127.0.0.1:1420`. UI edits hot reload. Rust CLI edits rebuild the backend, restart it after successful compilation, and refresh the browser. Failed compilations leave the previous backend running. Ctrl+C stops Vite, the backend, and the collector.

Use `pnpm dev:local --no-open` to suppress browser launch. Vite proxies `/api` to the development CLI server on port `54321`. Stop an existing development CLI before using the combined command. To run only Vite against an already running CLI, use `pnpm dev:local:ui`.

To check the embedded UI, run `pnpm dev:cli`, then `./target/debug/everr-dev local start`. The embedded UI on port `54321` updates when rebuilt. Collector Go changes require regenerating the embedded assets with `pnpm dev:cli` before restarting local development.

The local UI explores logs, traces, and errors stored by the local collector. Settings show collector status and local endpoints and allow collector restarts. No Cloud account is required to explore local telemetry. Optional sign-in connects the CLI to Everr Cloud using the same saved session. Install agent skills through the CLI.

## Telemetry

The UI sends its internal `everr-local-ui` events through the Rust backend at `/api/telemetry/{signal}`. `get_telemetry_context` supplies `serviceVersion`, `telemetryEnabled`, and `deploymentEnvironment`; the backend's build mode determines these values, independently of Vite's build mode. A disabled context prevents SDK initialization.

In debug builds, UI and CLI telemetry share the development collector. Run `everr-dev local status` to discover the local OTLP URL, or set `EVERR_INTERNAL_TELEMETRY_ENDPOINT` on the debug backend to select another OTLP/HTTP destination.

In release builds, the backend sends events only to `https://ingest.everr.dev` using Everr Labs' dedicated public `ingest/write` key, compiled via `EVERR_INTERNAL_TELEMETRY_INGEST_KEY`. No key is exposed through the context or frontend bundle, and the proxy does not forward the browser's `Origin` or authentication headers. Instead it sets `Origin: https://ui.everr.local`. The shared public key must allow both `https://ui.everr.local` and the CLI origin `https://cli.everr.local`. A release without a key disables internal telemetry. An unreachable cloud never causes a local fallback. The UI can continue exploring the user's local data while cloud export fails.

Release SQL error events use `Local telemetry query failed`, with a new stack that contains no query or response text. The original detailed error remains available to the UI. Query strings and fragments are stripped from telemetry URL attributes, including the SDK's landing URL, so Explore filters stay local. Debug builds retain detailed error telemetry.

Official activation, key rotation, and cloud/local ingestion checks are described in the [CLI Telemetry documentation](../cli/README.md#telemetry). Use the developer settings' error buttons to produce a uniquely timestamped event, then verify it with `everr cloud query` for a release or `everr-dev local query` for a debug build.
