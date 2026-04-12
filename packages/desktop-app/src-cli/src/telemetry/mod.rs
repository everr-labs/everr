//! Local diagnostic telemetry read path for the Everr CLI.
//!
//! Opens the telemetry directory written by the Desktop app's Tauri
//! sidecar, loads the DuckDB `otlp` extension, and exposes typed filters
//! over traces and logs. The CLI never writes to this directory and never
//! talks to the collector process — the filesystem is the whole interface.

pub mod commands;
pub mod query;
pub mod store;
