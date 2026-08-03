//! Fast, container-free integration tests (in-process HTTP stubs only), so they
//! stay ungated and run in local `cargo test` loops alongside the unit tests.

mod alert_log_shape_it;
mod derived_auth_it;
mod emit_it;
