//! Local diagnostic telemetry read path for the Everr CLI.
//!
//! Opens the telemetry directory written by the Desktop app's Tauri
//! sidecar, streams OTLP JSON files, and exposes typed filters over
//! traces and logs. The CLI never writes to this directory and never
//! talks to the collector process — the filesystem is the whole interface.

pub mod commands;
pub mod otlp;
pub mod query;
pub mod store;
