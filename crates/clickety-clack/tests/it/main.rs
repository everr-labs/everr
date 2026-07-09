//! Single container-backed integration-test binary for the whole package,
//! namespaced by the pipeline module each suite exercises. One binary keeps
//! link time down and lets every suite share one Postgres template container
//! (see `support`).

mod common;
mod support;

mod api;
mod dispatcher;
mod evaluator;
mod queue;
mod scheduler;
mod stores;

mod e2e_dispatch;
mod e2e_durability;
mod e2e_grouping;
mod e2e_reconcile_silence;
mod e2e_routing;
mod e2e_silences_inhibition;
mod load_dispatcher;
mod load_evaluator;
mod load_smoke;
