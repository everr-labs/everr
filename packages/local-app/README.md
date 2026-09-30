# Everr Local

TanStack Start browser UI for the local telemetry collector. The CLI embeds the SPA build and serves it on loopback.

Run `pnpm dev:local` from the repository root. It prepares embedded assets on the first run, builds and starts the Rust CLI and collector, and opens the Vite UI at `http://127.0.0.1:1420`. UI edits hot reload. Rust CLI and core edits rebuild the backend, restart it after successful compilation, and refresh the browser. Failed compilations leave the previous backend running. Ctrl+C stops Vite, the backend, and the collector.

Use `pnpm dev:local --no-open` to suppress browser launch. Vite proxies `/api` to the development CLI server on port `54321`. Stop an existing development CLI before using the combined command. To run only Vite against an already running CLI, use `pnpm dev:local:ui`.

To check the embedded UI, run `pnpm dev:cli`, then `./target/debug/everr-dev local start`. The embedded UI on port `54321` updates when rebuilt. Collector Go changes require regenerating the embedded assets with `pnpm dev:cli` before restarting local development.

The local UI reads the same Cloud session and local telemetry directory as the CLI. It includes logs, traces, errors, Cloud CI runs, sign-in, skills, and collector settings. Native tray, notification windows, autostart, and desktop update behavior are removed.
