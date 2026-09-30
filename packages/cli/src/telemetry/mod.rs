//! Local diagnostic telemetry read path for the Everr CLI.
//!
//! Starts and queries the local diagnostic telemetry collector.

pub mod client;
pub mod collector;
pub mod commands;

mod local_auth;
mod local_lifecycle;
mod local_log;
pub use local_log::Capture as LocalLogCapture;
pub mod local_instance;
pub mod local_server;
