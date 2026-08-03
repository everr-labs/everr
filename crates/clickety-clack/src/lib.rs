//! clickety-clack: a headless, multi-tenant alerting engine.
//!
//! One package, one module per pipeline stage. `main.rs` selects which
//! stages a process runs via `CC_ROLE`.

pub mod api;
pub mod clickhouse;
pub mod crypto;
pub mod dispatcher;
pub mod domain;
pub mod engine;
pub mod evaluator;
pub mod events;
pub mod otel;
pub mod queue;
pub mod scheduler;
pub mod sqlguard;
pub mod stores;
pub mod supervisor;
