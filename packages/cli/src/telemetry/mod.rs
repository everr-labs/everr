//! Local diagnostic telemetry read path for the Everr CLI.
//!
//! Starts and queries the local diagnostic telemetry collector.

pub mod client;
pub mod collector;
pub mod commands;

mod local_auth;
pub mod local_server;
pub mod local_instance;
